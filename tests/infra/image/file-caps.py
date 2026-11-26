"""POLY-104 F18: reads `docker export` of a container (the image's merged filesystem) on stdin and prints, as JSON, how many entries it saw and every
path that carries a security.capability xattr. Needs nothing inside the image."""
import json
import sys
import tarfile

seen, caps = 0, []
with tarfile.open(fileobj=sys.stdin.buffer, mode="r|") as tar:
    for member in tar:
        seen += 1
        if any("security.capability" in key for key in member.pax_headers):
            caps.append(member.name)
print(json.dumps({"entries": seen, "capabilities": sorted(caps)}))
