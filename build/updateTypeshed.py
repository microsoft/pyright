#!/usr/bin/env python3
"""
Script to update the typeshed-fallback folder with the latest files from
the typeshed repository (https://github.com/python/typeshed).

This script:
1. Clones/downloads the typeshed repository to a temporary directory
2. Copies the stdlib/ and stubs/ folders to typeshed-fallback
3. Copies the LICENSE and README.md files
4. Updates commit.txt with the current commit hash
"""

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def get_script_dir() -> Path:
    """Get the directory where this script is located."""
    return Path(__file__).parent.resolve()


def get_typeshed_fallback_dir() -> Path:
    """Get the path to the typeshed-fallback directory."""
    script_dir = get_script_dir()
    return script_dir.parent / "packages" / "pyright-internal" / "typeshed-fallback"


def run_git_command(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    """Run a git command and return the result."""
    return subprocess.run(
        ["git"] + args,
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    )


def clone_typeshed(target_dir: Path, commit: str | None = None) -> str:
    """
    Clone the typeshed repository to the target directory.
    
    Args:
        target_dir: Directory to clone into
        commit: Optional specific commit hash to checkout
        
    Returns:
        The commit hash that was checked out
    """
    typeshed_url = "https://github.com/python/typeshed.git"
    
    print(f"Cloning typeshed repository to {target_dir}...")
    
    # Clone with depth 1 for faster download (unless we need a specific commit)
    if commit:
        # Full clone needed for specific commit
        run_git_command(["clone", typeshed_url, str(target_dir)], cwd=target_dir.parent)
        run_git_command(["checkout", commit], cwd=target_dir)
    else:
        # Shallow clone for latest
        run_git_command(["clone", "--depth", "1", typeshed_url, str(target_dir)], cwd=target_dir.parent)
    
    # Get the current commit hash
    result = run_git_command(["rev-parse", "HEAD"], cwd=target_dir)
    commit_hash = result.stdout.strip()
    
    print(f"Checked out commit: {commit_hash}")
    return commit_hash


def remove_directory_contents(dir_path: Path) -> None:
    """Remove all contents of a directory but keep the directory itself."""
    if dir_path.exists():
        shutil.rmtree(dir_path)
    dir_path.mkdir(parents=True, exist_ok=True)


def should_copy_file(file_path: Path) -> bool:
    """Check if a file should be copied based on its extension or name."""
    allowed_extensions = {".pyi", ".toml"}
    allowed_names = {"VERSIONS"}
    return file_path.suffix.lower() in allowed_extensions or file_path.name in allowed_names


def is_in_excluded_folder(file_path: Path, base_folder: Path) -> bool:
    """Check if the file is inside a folder that starts with '@'."""
    rel_path = file_path.relative_to(base_folder)
    for part in rel_path.parts:
        if part.startswith("@"):
            return True
    return False


def copy_tree_filtered(src_folder: Path, dst_folder: Path) -> None:
    """
    Copy a directory tree, only including .pyi and VERSIONS files.
    Skips any folder starting with '@'.
    
    Args:
        src_folder: Source directory
        dst_folder: Destination directory
    """
    for src_path in src_folder.rglob("*"):
        if src_path.is_file() and should_copy_file(src_path):
            # Skip files in folders starting with '@'
            if is_in_excluded_folder(src_path, src_folder):
                continue
            
            # Calculate relative path and destination
            rel_path = src_path.relative_to(src_folder)
            dst_path = dst_folder / rel_path
            
            # Create parent directories if needed
            dst_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Copy the file
            shutil.copy2(src_path, dst_path)


def copy_typeshed_files(source_dir: Path, dest_dir: Path) -> None:
    """
    Copy the relevant typeshed files to the destination directory.
    Only .pyi and VERSIONS files are copied from folders.
    
    Args:
        source_dir: The cloned typeshed repository directory
        dest_dir: The typeshed-fallback directory
    """
    # Folders to copy
    folders_to_copy = ["stdlib", "stubs"]
    
    # Copy folders (only .py and .pyi files)
    for folder in folders_to_copy:
        src_folder = source_dir / folder
        dst_folder = dest_dir / folder
        
        if not src_folder.exists():
            print(f"Warning: Source folder {src_folder} does not exist, skipping...")
            continue
            
        print(f"Copying {folder}/ (only .pyi and VERSIONS files)...")
        
        # Remove existing folder contents
        remove_directory_contents(dst_folder)
        
        # Copy the folder with filtering
        copy_tree_filtered(src_folder, dst_folder)

    # Files to copy
    files_to_copy = ["LICENSE", "README.md"]
    
    # Copy files
    for file in files_to_copy:
        src_file = source_dir / file
        dst_file = dest_dir / file
        
        if not src_file.exists():
            print(f"Warning: Source file {src_file} does not exist, skipping...")
            continue
            
        print(f"Copying {file}...")
        shutil.copy2(src_file, dst_file)


def update_commit_file(dest_dir: Path, commit_hash: str) -> None:
    """Update the commit.txt file with the new commit hash."""
    commit_file = dest_dir / "commit.txt"
    print(f"Updating commit.txt with {commit_hash}...")
    commit_file.write_text(commit_hash + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Update typeshed-fallback with the latest typeshed files"
    )
    parser.add_argument(
        "--commit",
        "-c",
        type=str,
        default=None,
        help="Specific commit hash to checkout (default: latest main branch)",
    )
    parser.add_argument(
        "--dry-run",
        "-n",
        action="store_true",
        help="Show what would be done without making changes",
    )
    
    args = parser.parse_args()
    
    typeshed_fallback_dir = get_typeshed_fallback_dir()
    
    if not typeshed_fallback_dir.exists():
        print(f"Error: typeshed-fallback directory not found at {typeshed_fallback_dir}")
        return 1
    
    print(f"Typeshed fallback directory: {typeshed_fallback_dir}")
    
    if args.dry_run:
        print("\n*** DRY RUN - No changes will be made ***\n")
        print("Would perform the following actions:")
        print("  1. Clone typeshed repository to a temporary directory")
        if args.commit:
            print(f"  2. Checkout commit: {args.commit}")
        else:
            print("  2. Use latest commit from main branch")
        print("  3. Copy stdlib/ folder (only .pyi and VERSIONS files)")
        print("  4. Copy stubs/ folder (only .pyi and VERSIONS files)")
        print("  5. Copy LICENSE file")
        print("  6. Copy README.md file")
        print("  7. Update commit.txt with new commit hash")
        return 0
    
    # Create a temporary directory for cloning
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        typeshed_clone_dir = temp_path / "typeshed"
        
        try:
            # Clone typeshed
            commit_hash = clone_typeshed(typeshed_clone_dir, args.commit)
            
            # Copy files
            copy_typeshed_files(typeshed_clone_dir, typeshed_fallback_dir)
            
            # Update commit.txt
            update_commit_file(typeshed_fallback_dir, commit_hash)
            
            print("\nTypeshed update complete!")
            print(f"Updated to commit: {commit_hash}")
            
        except subprocess.CalledProcessError as e:
            print(f"Error running git command: {e}")
            print(f"stdout: {e.stdout}")
            print(f"stderr: {e.stderr}")
            return 1
        except Exception as e:
            print(f"Error: {e}")
            return 1
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
