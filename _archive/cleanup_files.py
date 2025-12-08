import os
import shutil

files_to_move = [
    'check_analytics_packages.py',
    'check_app.py',
    'test_routes.py',
    'test_startup.py',
    'install_dependencies.py',
    'install_and_verify.ps1',
    'fix_and_run.bat',
    'nuclear_fix.bat',
    'start_server.bat'
]

destination = '_archive'

if not os.path.exists(destination):
    os.makedirs(destination)
    print(f"Created directory: {destination}")

for file in files_to_move:
    if os.path.exists(file):
        try:
            shutil.move(file, os.path.join(destination, file))
            print(f"Moved: {file}")
        except Exception as e:
            print(f"Error moving {file}: {e}")
    else:
        print(f"File not found (already moved?): {file}")
