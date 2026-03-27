import shutil
from pathlib import Path


def main() -> None:
    skill_dir = Path(__file__).resolve().parent
    addon_dir = skill_dir / "blender_addon_9lives"
    dist_dir = skill_dir / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    archive_base = dist_dir / "blender_addon_9lives"
    shutil.make_archive(str(archive_base), "zip", root_dir=skill_dir, base_dir="blender_addon_9lives")
    print(archive_base.with_suffix(".zip"))


if __name__ == "__main__":
    main()
