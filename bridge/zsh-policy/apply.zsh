typeset _shell_to_chrome_startup_file="$1"

if [[ -n "$_SHELL_TO_CHROME_USER_ZDOTDIR" && "$_SHELL_TO_CHROME_USER_ZDOTDIR" != "$_SHELL_TO_CHROME_ENFORCED_ZDOTDIR" ]]; then
  typeset _shell_to_chrome_user_startup="$_SHELL_TO_CHROME_USER_ZDOTDIR/$_shell_to_chrome_startup_file"
  if [[ -r "$_shell_to_chrome_user_startup" ]]; then
    ZDOTDIR="$_SHELL_TO_CHROME_USER_ZDOTDIR"
    source "$_shell_to_chrome_user_startup"
  fi
fi

if [[ -n "${HISTFILE:-}" && "$HISTFILE" == "$_SHELL_TO_CHROME_ENFORCED_ZDOTDIR/"* ]]; then
  HISTFILE="$_SHELL_TO_CHROME_USER_ZDOTDIR/${HISTFILE#$_SHELL_TO_CHROME_ENFORCED_ZDOTDIR/}"
fi

ZDOTDIR="$_SHELL_TO_CHROME_ENFORCED_ZDOTDIR"
path=("$_SHELL_TO_CHROME_ENFORCED_SSH_WRAPPER_DIR" ${path:#$_SHELL_TO_CHROME_ENFORCED_SSH_WRAPPER_DIR})
export PATH
rehash

unset _shell_to_chrome_startup_file
unset _shell_to_chrome_user_startup
