# Sourced by every dry-run script. Puts the fakes first, removes anything that could reach a provider, and fails
# before the test runs if hcloud or curl resolve outside the fakes directory (R3).
export PATH=/fakes:$PATH FAKE_STATE=/var/fake-state
unset HCLOUD_TOKEN HCLOUD_CONTEXT
export HCLOUD_CONFIG=/nonexistent/none.toml
mkdir -p "$FAKE_STATE" /dev/disk/by-id
[ -e /dev/disk/by-id/scsi-0HC_Volume_100000001 ] || : > /dev/disk/by-id/scsi-0HC_Volume_100000001
[ -e "$FAKE_STATE/volume" ] || echo empty > "$FAKE_STATE/volume"
for c in hcloud curl docker; do
  case "$(command -v "$c")" in /fakes/*) ;; *) echo "HARNESS: $c resolves outside the fakes dir: $(command -v "$c")" >&2; exit 97 ;; esac
done
