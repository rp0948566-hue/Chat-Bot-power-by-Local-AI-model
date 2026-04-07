import os
import platform
import ctypes
import sys

def lock_screen():
    system = platform.system()
    try:
        if system == "Windows":
            ctypes.windll.user32.LockWorkStation()
            print("Windows: LockWorkStation successful.")
        elif system == "Darwin": # macOS
            # Different methods for macOS, pmset is reliable for display sleep/lock
            os.system("pmset display sleep now")
            # Alternative: os.system("/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend")
            print("macOS: Screen lock triggered.")
        elif system == "Linux":
            # Common Linux lock commands
            commands = [
                "gnome-screensaver-command -l",
                "xdg-screensaver lock",
                "dbus-send --type=method_call --dest=org.gnome.ScreenSaver /org/gnome/ScreenSaver org.gnome.ScreenSaver.Lock",
                "loginctl lock-session"
            ]
            success = False
            for cmd in commands:
                if os.system(cmd) == 0:
                    print(f"Linux: Used {cmd.split()[0]}.")
                    success = True
                    break
            if not success:
                print("Linux: No compatible lock command found.")
        else:
            print(f"Unsupported OS: {system}")
            sys.exit(1)
    except Exception as e:
        print(f"Error locking screen: {e}")
        sys.exit(1)

if __name__ == "__main__":
    lock_screen()
