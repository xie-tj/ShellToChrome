@echo off
setlocal
if not defined SHELL_TO_CHROME_REAL_SSH (
  echo Native OpenSSH client not found. 1>&2
  exit /b 127
)

"%SHELL_TO_CHROME_REAL_SSH%" ^
  -o PreferredAuthentications=publickey,gssapi-with-mic ^
  -o PubkeyAuthentication=yes ^
  -o GSSAPIAuthentication=yes ^
  -o PasswordAuthentication=no ^
  -o KbdInteractiveAuthentication=no ^
  -o ChallengeResponseAuthentication=no ^
  -o HostbasedAuthentication=no ^
  -o NumberOfPasswordPrompts=0 ^
  -o ControlMaster=no ^
  -o ControlPath=none ^
  -o ControlPersist=no ^
  %*
