#!/bin/bash
set -e

# Default UID and GID to 10001 if not provided
PUID=${PUID:-10001}
PGID=${PGID:-10001}

# Only modify if it's not root (PUID=0)
if [ "$PUID" -ne 0 ]; then
    # Modify the reader group and user to match requested PGID/PUID
    groupmod -o -g "$PGID" reader
    usermod -o -u "$PUID" reader
    
    # Fix ownership of the storage directory
    chown -R "$PUID":"$PGID" /app/storage
    
    # Execute the command as the reader user using gosu
    exec gosu reader "$@"
else
    # If PUID=0 is explicitly requested, run as root
    exec "$@"
fi

