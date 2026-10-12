Built from https://github.com/WenXiaoWendy/galatea-garden-wake-bridge at commit f0cd9c27f1b95d6ff8bd8e0f367de7d4518a1c81 (v0.2.1, MIT, see LICENSE).
Only the compiled dist/*.js is vendored here so the VPS needs Node 20+ but no npm build.
inject-imprint.py is Imprint's own injector. Do not add reconnects or auto restarts: the bridge is fail-closed by design.
