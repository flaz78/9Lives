<#
.SYNOPSIS
    Outlook Calendar Bridge per 9Lives AI (via Microsoft Graph API).

.DESCRIPTION
    Autentica l'utente tramite device code flow usando l'app Microsoft ufficiale
    "Microsoft Graph Command Line Tools" — NON richiede registrazione su Azure.
    Espone una REST API locale accessibile dai container Docker.

.PARAMETER Port
    Porta del server (default: 8765).

.PARAMETER Token
    Token Bearer per proteggere la REST API. Se omesso, ne viene generato uno.

.PARAMETER TokenFile
    File dove salvare il refresh token Microsoft (default: .\ms_token.json).
    Evita di ri-autenticarsi ad ogni avvio.
#>
param(
    [int]$Port      = 8765,
    [string]$Token  = "",
    [string]$TokenFile = "$PSScriptRoot\ms_token.json"
)

# ── Costanti Microsoft Graph ──────────────────────────────────────────────
# Client ID dell'app ufficiale Microsoft "Graph Command Line Tools"
# Nessuna registrazione Azure necessaria, funziona con qualsiasi account M365.
$CLIENT_ID  = "14d82eec-204b-4c2f-b7e8-296a70dab67e"
$TENANT     = "common"
$SCOPES     = "https://graph.microsoft.com/Calendars.ReadWrite offline_access"
$GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# ── Token API locale ───────────────────────────────────────────────────────
if (-not $Token) {
    $bytes = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24)
    $Token = [System.Convert]::ToBase64String($bytes) -replace '[+/=]', 'x'
    Write-Host ""
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "  TOKEN PER DOCKER (copia nel .env):    " -ForegroundColor Cyan
    Write-Host "  OUTLOOK_BRIDGE_TOKEN=$Token" -ForegroundColor Yellow
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host ""
}

Add-Type -AssemblyName System.Web

# ══ Auth Microsoft Graph ═══════════════════════════════════════════════════

$script:msAccessToken  = $null
$script:msRefreshToken = $null
$script:tokenExpiresAt = [DateTime]::MinValue

function Save-MsToken($tokenResp) {
    $script:msAccessToken  = $tokenResp.access_token
    $script:msRefreshToken = $tokenResp.refresh_token
    $script:tokenExpiresAt = (Get-Date).AddSeconds($tokenResp.expires_in - 60)
    # Salva refresh token su file per i prossimi avvii
    @{ refresh_token = $script:msRefreshToken } | ConvertTo-Json | Set-Content $TokenFile -Encoding UTF8
    Write-Host "Token salvato in $TokenFile" -ForegroundColor Gray
}

function Request-DeviceCodeAuth() {
    Write-Host ""
    Write-Host "── Autenticazione Microsoft 365 ──────────────────" -ForegroundColor Cyan

    $dcResp = Invoke-RestMethod -Method Post `
        -Uri "https://login.microsoftonline.com/$TENANT/oauth2/v2.0/devicecode" `
        -ContentType "application/x-www-form-urlencoded" `
        -Body "client_id=$CLIENT_ID&scope=$([System.Web.HttpUtility]::UrlEncode($SCOPES))"

    Write-Host ""
    Write-Host "  1. Il browser si aprira' su: $($dcResp.verification_uri)" -ForegroundColor Yellow
    Write-Host "  2. Inserisci il codice:  $($dcResp.user_code)" -ForegroundColor Green
    Write-Host ""
    Start-Process $dcResp.verification_uri

    $interval  = if ($dcResp.interval) { $dcResp.interval } else { 5 }
    $expiresAt = (Get-Date).AddSeconds($dcResp.expires_in)

    Write-Host "In attesa dell'autenticazione" -NoNewline
    while ((Get-Date) -lt $expiresAt) {
        Start-Sleep -Seconds $interval
        Write-Host "." -NoNewline

        try {
            $tokenResp = Invoke-RestMethod -Method Post `
                -Uri "https://login.microsoftonline.com/$TENANT/oauth2/v2.0/token" `
                -ContentType "application/x-www-form-urlencoded" `
                -Body "grant_type=urn:ietf:params:oauth:grant-type:device_code&client_id=$CLIENT_ID&device_code=$($dcResp.device_code)"

            Write-Host ""
            Write-Host "Autenticazione completata!" -ForegroundColor Green
            Save-MsToken $tokenResp
            return
        } catch {
            $errBody = $null
            try { $errBody = $_.ErrorDetails.Message | ConvertFrom-Json } catch { }
            if ($errBody -and $errBody.error -eq "authorization_pending") { continue }
            if ($errBody -and $errBody.error -eq "authorization_declined") { throw "Autenticazione rifiutata." }
            if ($errBody -and $errBody.error -eq "expired_token")          { throw "Codice scaduto. Riavvia." }
            throw $_
        }
    }
    throw "Timeout durante l'autenticazione."
}

function Ensure-ValidToken() {
    # Usa refresh token salvato se il token è scaduto
    if ((Get-Date) -lt $script:tokenExpiresAt) { return }

    if ($script:msRefreshToken) {
        Write-Host "Rinnovo token Microsoft..." -ForegroundColor Gray
        try {
            $tokenResp = Invoke-RestMethod -Method Post `
                -Uri "https://login.microsoftonline.com/$TENANT/oauth2/v2.0/token" `
                -ContentType "application/x-www-form-urlencoded" `
                -Body "grant_type=refresh_token&client_id=$CLIENT_ID&refresh_token=$($script:msRefreshToken)&scope=$([System.Web.HttpUtility]::UrlEncode($SCOPES))"
            Save-MsToken $tokenResp
            return
        } catch {
            Write-Warning "Impossibile rinnovare il token: $($_.Exception.Message)"
        }
    }
    # Nessun refresh token valido: ri-autentica
    Request-DeviceCodeAuth
}

function Invoke-Graph($method, $path, $body = $null) {
    Ensure-ValidToken
    $params = @{
        Method  = $method
        Uri     = "$GRAPH_BASE$path"
        Headers = @{ Authorization = "Bearer $($script:msAccessToken)" }
    }
    if ($body) {
        $params.ContentType = "application/json"
        $params.Body        = $body | ConvertTo-Json -Depth 10
    }
    return Invoke-RestMethod @params
}

# ── Inizializzazione auth ──────────────────────────────────────────────────
if (Test-Path $TokenFile) {
    try {
        $saved = Get-Content $TokenFile -Raw | ConvertFrom-Json
        $script:msRefreshToken = $saved.refresh_token
        Write-Host "Refresh token caricato da $TokenFile" -ForegroundColor Gray
        Ensure-ValidToken
        Write-Host "Autenticazione Microsoft 365: OK" -ForegroundColor Green
    } catch {
        Write-Warning "Token salvato non valido, ri-autenticazione necessaria."
        Request-DeviceCodeAuth
    }
} else {
    Request-DeviceCodeAuth
}

# ── Helpers ────────────────────────────────────────────────────────────────
function Send-Response($context, [int]$statusCode, $data) {
    $r = $context.Response
    $r.StatusCode      = $statusCode
    $r.ContentType     = "application/json; charset=utf-8"
    $json   = $data | ConvertTo-Json -Depth 10 -Compress
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
    $r.ContentLength64 = $buffer.Length
    $r.OutputStream.Write($buffer, 0, $buffer.Length)
    $r.OutputStream.Close()
}

function Format-GraphEvent($e) {
    @{
        id              = $e.id
        subject         = $e.subject
        start           = $e.start.dateTime + "Z"
        end             = $e.end.dateTime   + "Z"
        location        = $e.location.displayName
        bodyPreview     = $e.bodyPreview
        organizer       = $e.organizer.emailAddress.address
        isAllDay        = $e.isAllDay
        isCancelled     = $e.isCancelled
        isOnlineMeeting = $e.isOnlineMeeting
        meetingUrl      = $e.onlineMeeting.joinUrl
        attendees       = @($e.attendees | ForEach-Object {
            @{ email = $_.emailAddress.address; name = $_.emailAddress.name; status = $_.status.response }
        })
    }
}

function Read-Body($req) {
    [System.IO.StreamReader]::new($req.InputStream, [System.Text.Encoding]::UTF8).ReadToEnd() | ConvertFrom-Json
}

# ── HTTP Listener ──────────────────────────────────────────────────────────
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://+:$Port/")
try {
    $listener.Start()
} catch {
    Write-Error "Impossibile avviare sulla porta $Port. Esegui come Amministratore oppure lancia:`nnetsh http add urlacl url=http://+:$Port/ user=$env:USERDOMAIN\$env:USERNAME"
    exit 1
}

# Regola firewall (richiede Admin, ignora errori silenziosamente)
try {
    $rn = "9Lives Outlook Bridge $Port"
    if (-not (Get-NetFirewallRule -DisplayName $rn -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $rn -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
    }
} catch { }

Write-Host ""
Write-Host "Bridge attivo su http://0.0.0.0:$Port" -ForegroundColor Cyan
Write-Host "Premi Ctrl+C per fermare." -ForegroundColor Gray
Write-Host ""

# ══ Loop principale ══════════════════════════════════════════════════════════
while ($listener.IsListening) {
    try {
        $ctx    = $listener.GetContext()
        $req    = $ctx.Request
        $method = $req.HttpMethod
        $path   = $req.Url.LocalPath
        $query  = [System.Web.HttpUtility]::ParseQueryString($req.Url.Query)

        Write-Host "$(Get-Date -Format 'HH:mm:ss') $method $path" -ForegroundColor Gray

        # Auth
        if ($req.Headers["Authorization"] -ne "Bearer $Token") {
            Send-Response $ctx 401 @{ error = "Unauthorized" }; continue
        }

        # ── GET /health ───────────────────────────────────────────────────
        if ($method -eq "GET" -and $path -eq "/health") {
            $me = Invoke-Graph "GET" "/me?`$select=displayName,mail"
            Send-Response $ctx 200 @{ ok = $true; user = $me.displayName; email = $me.mail }
            continue
        }

        # ── GET /events ───────────────────────────────────────────────────
        if ($method -eq "GET" -and $path -eq "/events") {
            $start = if ($query["start"]) { $query["start"] } else { [DateTime]::Today.ToString("o") }
            $end   = if ($query["end"])   { $query["end"] }   else { [DateTime]::Today.AddDays(7).ToString("o") }
            $maxRaw = if ($query["max"])  { [int]$query["max"] } else { 50 }
            $max   = [Math]::Min($maxRaw, 100)

            $qs = [System.Web.HttpUtility]::UrlEncode(
                "`$top=$max&`$orderby=start/dateTime&`$select=id,subject,start,end,location,isOnlineMeeting,onlineMeeting,bodyPreview,organizer,attendees,isAllDay,isCancelled"
            )
            $resp   = Invoke-Graph "GET" "/me/calendarView?startDateTime=$start&endDateTime=$end&$qs"
            $events = @($resp.value | ForEach-Object { Format-GraphEvent $_ })
            Send-Response $ctx 200 @{ count = $events.Count; events = $events }
            continue
        }

        # ── POST /events ──────────────────────────────────────────────────
        if ($method -eq "POST" -and $path -eq "/events") {
            $d    = Read-Body $req
            $body = @{
                subject = $d.subject
                start   = @{ dateTime = $d.startDateTime -replace 'Z$',''; timeZone = "UTC" }
                end     = @{ dateTime = $d.endDateTime   -replace 'Z$',''; timeZone = "UTC" }
            }
            if ($d.PSObject.Properties["body"]          -and $d.body)          { $body.body          = @{ contentType = "text"; content = $d.body } }
            if ($d.PSObject.Properties["location"]      -and $d.location)       { $body.location      = @{ displayName = $d.location } }
            if ($d.PSObject.Properties["isOnlineMeeting"]) { $body.isOnlineMeeting = $d.isOnlineMeeting }
            if ($d.PSObject.Properties["attendees"]     -and $d.attendees.Count -gt 0) {
                $body.attendees = @($d.attendees | ForEach-Object { @{ emailAddress = @{ address = $_ }; type = "required" } })
            }
            $created = Invoke-Graph "POST" "/me/events" $body
            Send-Response $ctx 201 @{ success = $true; id = $created.id; event = (Format-GraphEvent $created); message = "Evento creato." }
            continue
        }

        # ── PATCH /events/{id} ────────────────────────────────────────────
        if ($method -eq "PATCH" -and $path -match "^/events/(.+)$") {
            $id   = [System.Web.HttpUtility]::UrlDecode($Matches[1])
            $d    = Read-Body $req
            $body = @{}
            if ($d.PSObject.Properties["subject"]       -and $null -ne $d.subject)       { $body.subject  = $d.subject }
            if ($d.PSObject.Properties["startDateTime"] -and $d.startDateTime)           { $body.start    = @{ dateTime = $d.startDateTime -replace 'Z$',''; timeZone = "UTC" } }
            if ($d.PSObject.Properties["endDateTime"]   -and $d.endDateTime)             { $body.end      = @{ dateTime = $d.endDateTime   -replace 'Z$',''; timeZone = "UTC" } }
            if ($d.PSObject.Properties["body"]          -and $null -ne $d.body)          { $body.body     = @{ contentType = "text"; content = $d.body } }
            if ($d.PSObject.Properties["location"]      -and $null -ne $d.location)      { $body.location = @{ displayName = $d.location } }
            $updated = Invoke-Graph "PATCH" "/me/events/$id" $body
            Send-Response $ctx 200 @{ success = $true; event = (Format-GraphEvent $updated); message = "Evento aggiornato." }
            continue
        }

        # ── DELETE /events/{id} ───────────────────────────────────────────
        if ($method -eq "DELETE" -and $path -match "^/events/(.+)$") {
            $id = [System.Web.HttpUtility]::UrlDecode($Matches[1])
            Invoke-Graph "DELETE" "/me/events/$id" | Out-Null
            Send-Response $ctx 200 @{ success = $true; message = "Evento eliminato." }
            continue
        }

        Send-Response $ctx 404 @{ error = "Endpoint non trovato: $method $path" }

    } catch {
        Write-Warning "Errore: $($_.Exception.Message)"
        try { Send-Response $ctx 500 @{ error = $_.Exception.Message } } catch { }
    }
}

$listener.Stop()
Write-Host "Bridge fermato." -ForegroundColor Yellow
