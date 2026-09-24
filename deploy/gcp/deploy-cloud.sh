#!/usr/bin/env bash
set -Eeuo pipefail

readonly expected_prefix='asia-southeast2-docker.pkg.dev/project-21f41328-b088-4894-b3f/itulah-pilot/cloud@sha256:'
readonly service='itulah-cloud.service'
readonly dropin_dir="/etc/systemd/system/${service}.d"
readonly dropin="${dropin_dir}/20-image.conf"
readonly state_dir='/var/lib/itulah-cloud-deploy'
readonly current_file="${state_dir}/current-image"
readonly previous_file="${state_dir}/previous-image"
readonly health_url='http://100.64.0.1:8080/api/v1/health'

fail() {
  echo "itulah deploy: $*" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || fail 'must run as root'
[[ $# -eq 1 ]] || fail 'usage: itulah-deploy-cloud IMAGE@sha256:DIGEST'

new_image="$1"
[[ "${new_image}" == "${expected_prefix}"* ]] || fail 'image must come from the pilot Artifact Registry repository'
digest="${new_image#${expected_prefix}}"
[[ "${digest}" =~ ^[0-9a-f]{64}$ ]] || fail 'image must use a complete sha256 digest'

mkdir -p "${state_dir}" "${dropin_dir}"
chmod 0750 "${state_dir}"

previous_image=''
if [[ -s "${current_file}" ]]; then
  previous_image="$(cat "${current_file}")"
else
  # Bootstrap rollback state from the image already running before this
  # script has been installed for the first time.
  active_image="$(/usr/bin/docker inspect itulah-cloud --format='{{.Config.Image}}' 2>/dev/null || true)"
  if [[ -n "${active_image}" ]]; then
    if [[ "${active_image}" == *@sha256:* ]]; then
      previous_image="${active_image}"
    else
      previous_image="$(/usr/bin/docker image inspect "${active_image}" --format='{{range .RepoDigests}}{{println .}}{{end}}' 2>/dev/null \
        | /usr/bin/grep -F "${expected_prefix}" | /usr/bin/head -n 1 || true)"
    fi
  fi
fi

if [[ "${previous_image}" == "${new_image}" ]]; then
  echo "itulah deploy: ${new_image} is already the pinned release"
  exit 0
fi

/usr/bin/docker pull "${new_image}"

write_image_dropin() {
  local image="$1"
  local tmp
  tmp="$(/usr/bin/mktemp "${dropin}.XXXXXX")"
  {
    printf '[Service]\n'
    printf 'ExecStart=\n'
    printf 'ExecStart=/usr/bin/docker run --rm --name itulah-cloud --network host --env-file /etc/itulah-cloud.env %s\n' "${image}"
  } >"${tmp}"
  chmod 0644 "${tmp}"
  mv -f "${tmp}" "${dropin}"
}

health_ok() {
  local attempt
  for attempt in $(seq 1 30); do
    if /usr/bin/curl -fsS --max-time 3 "${health_url}" 2>/dev/null | /usr/bin/grep -Eq '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      return 0
    fi
    sleep 3
  done
  return 1
}

write_image_dropin "${new_image}"
/usr/bin/systemctl daemon-reload
if ! /usr/bin/systemctl restart "${service}" || ! health_ok; then
  echo 'itulah deploy: new release failed health check; restoring previous image' >&2
  if [[ -n "${previous_image}" ]]; then
    write_image_dropin "${previous_image}"
    /usr/bin/systemctl daemon-reload
    /usr/bin/systemctl restart "${service}"
    if ! health_ok; then
      fail 'rollback image did not pass health check; inspect systemctl status and logs'
    fi
    printf '%s\n' "${previous_image}" >"${current_file}"
    fail 'new release failed health check; previous release restored'
  fi
  fail 'new release failed health check and no previous digest was available'
fi

if [[ -n "${previous_image}" ]]; then
  printf '%s\n' "${previous_image}" >"${previous_file}"
fi
printf '%s\n' "${new_image}" >"${current_file}"
chmod 0640 "${current_file}" "${previous_file}" 2>/dev/null || chmod 0640 "${current_file}"
echo "itulah deploy: active release is ${new_image}"
