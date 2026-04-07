import os
from pathlib import Path

IGNORE_DIRS = {
     "node_modules",
    # ".git",
    # "dist",
    # "build",
    # ".vite",
    # ".next"
}

def generate_tree(dir_path, prefix=""):
    path_obj = Path(dir_path)

    try:
        contents = sorted(
            [p for p in path_obj.iterdir() if p.name not in IGNORE_DIRS],
            key=lambda s: s.name.lower()
        )
    except PermissionError:
        print(f"{prefix}[ACCESS DENIED]")
        return

    count = len(contents)

    for index, item in enumerate(contents):
        is_last = (index == count - 1)
        connector = "└── " if is_last else "├── "
        print(f"{prefix}{connector}{item.name}")

        if item.is_dir():
            extension = "    " if is_last else "│   "
            generate_tree(item, prefix + extension)

if __name__ == "__main__":
    current_directory = os.getcwd()
    print(f"\n{os.path.basename(current_directory)}/")
    generate_tree(current_directory)
    print("\nScan Complete.")