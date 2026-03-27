$fn = 128;

// Poltrona a uovo scavata con seduta integrata
// Unità in mm

shell_w = 900;
shell_d = 820;
shell_h = 1250;
wall = 28;

base_d = 520;
base_h = 35;
stem_d = 90;
stem_h = 220;

seat_h = 120;
seat_w = 560;
seat_d = 500;
seat_tilt = -8;
seat_z = 360;

opening_w = 640;
opening_h = 760;
opening_z = 320;

floor_cut = 120;
back_tilt = -10;

module ellipsoid(w,d,h){
    scale([w/2,d/2,h/2]) sphere(1);
}

module shell_outer(){
    rotate([back_tilt,0,0]) ellipsoid(shell_w,shell_d,shell_h);
}

module shell_inner(){
    translate([0,0,wall])
        rotate([back_tilt,0,0])
            ellipsoid(shell_w-2*wall, shell_d-2*wall, shell_h-2*wall);
}

module front_opening(){
    translate([-opening_w/2, shell_d*0.05, opening_z])
        cube([opening_w, shell_d, opening_h]);
}

module bottom_cut(){
    translate([-shell_w, -shell_d, -shell_h])
        cube([2*shell_w, 2*shell_d, shell_h/2 + floor_cut]);
}

module seat_bucket(){
    translate([0, -40, seat_z])
        rotate([seat_tilt,0,0])
            difference(){
                scale([seat_w/2, seat_d/2, seat_h/2]) sphere(1);
                translate([-seat_w, -seat_d, seat_h*0.05])
                    cube([2*seat_w, 2*seat_d, seat_h]);
            }
}

module egg_chair(){
    difference(){
        difference(){
            shell_outer();
            shell_inner();
        }
        front_opening();
        bottom_cut();
    }
}

module pedestal(){
    union(){
        cylinder(d=base_d, h=base_h);
        translate([0,0,base_h]) cylinder(d=stem_d, h=stem_h);
    }
}

union(){
    pedestal();
    translate([0,0,base_h + stem_h + shell_h/2 - 120]) egg_chair();
    translate([0,0,base_h + stem_h]) seat_bucket();
}
