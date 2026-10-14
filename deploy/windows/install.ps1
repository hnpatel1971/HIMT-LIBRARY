# Installs or updates the HIMT Library on the Windows server that runs HIMT-LMS.
#
# Run in PowerShell as Administrator:
#   powershell -ExecutionPolicy Bypass -File install.ps1
#
# It reuses what the HIMT-LMS installer already set up (IIS with URL Rewrite
# and ARR, Node 24, Git, NSSM and PostgreSQL 17) and installs any of them that
# are missing. The first run creates C:\himt-library-config\himt-library.env
# and stops so you can fill it in. The second run builds the app, creates the
# "library" database (loading library-data.sql from the config folder if it is
# there), starts the HIMT-Library Windows service and adds an IIS site for it.
# Run it again any time to update to the latest code. See docs/deploy-windows.md.

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072
$ProgressPreference = "SilentlyContinue"

$AppDir = "C:\himt-library"
$ConfigDir = "C:\himt-library-config"
$EnvFile = Join-Path $ConfigDir "himt-library.env"
$DataFile = Join-Path $ConfigDir "library-data.sql"
$LmsEnvFile = "C:\himt-lms-config\himt-lms.env"
$SiteDir = "C:\inetpub\himt-library"
$Repo = "https://github.com/hnpatel1971/HIMT-LIBRARY.git"
$Branch = "main"
$ServiceName = "HIMT-Library"
$SiteName = "himt-library"
$Database = "library"
$PgBin = "C:\Program Files\PostgreSQL\17\bin"

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

function Add-MachinePath($dir) {
  $current = [Environment]::GetEnvironmentVariable("Path", "Machine")
  if (($current -split ";") -notcontains $dir) {
    [Environment]::SetEnvironmentVariable("Path", "$current;$dir", "Machine")
  }
  Refresh-Path
}

function Has($command) { [bool](Get-Command $command -ErrorAction SilentlyContinue) }

function Run($exe, [string[]]$arguments) {
  & $exe @arguments
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 3010) {
    throw "'$exe $($arguments -join ' ')' failed with exit code $LASTEXITCODE"
  }
}

function New-Secret {
  $bytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Read-EnvFile($path) {
  $values = [ordered]@{}
  foreach ($line in Get-Content $path) {
    $text = $line.Trim()
    if (-not $text -or $text.StartsWith("#")) { continue }
    $split = $text.IndexOf("=")
    if ($split -lt 1) { continue }
    $value = $text.Substring($split + 1).Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$text.Substring(0, $split).Trim()] = $value
  }
  $values
}

# --- Settings file ---

if (-not (Test-Path $EnvFile)) {
  Step "Creating $EnvFile"
  New-Item -ItemType Directory -Force $ConfigDir | Out-Null
  # Only Administrators and the service account may read the settings.
  & icacls $ConfigDir /inheritance:r /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F" | Out-Null
  # Use the PostgreSQL that HIMT-LMS already runs, with the same password.
  $pgPasswordGuess = "FILL_ME"
  if (Test-Path $LmsEnvFile) {
    $found = ([regex]::Match((Read-EnvFile $LmsEnvFile)["DATABASE_URL"], "^postgres://postgres:([^@]+)@")).Groups[1].Value
    if ($found) { $pgPasswordGuess = $found }
  }
  $template = @"
# HIMT Library settings, one NAME=value per line. Lines starting with # are ignored.
# Replace every FILL_ME, save, and run install.ps1 again.
NODE_ENV=production
PORT=8090
WEB_DIST_DIR=$AppDir\web\dist
DATABASE_URL=postgres://postgres:$pgPasswordGuess@127.0.0.1:5432/$Database
SESSION_SECRET=$(New-Secret)

# The first admin login. It is created once; change the password in the app later.
ADMIN_USERNAME=FILL_ME
ADMIN_PASSWORD=FILL_ME

# Web address for the library, e.g. library.himtmarine.com, once its DNS points
# at this server. Leave empty to reach the library at http://<server IP>:<port>/,
# where the port is SITE_PORT, or the first free one from 8081 if that is empty.
SITE_HOST=
SITE_PORT=
"@
  Set-Content -Path $EnvFile -Value $template -Encoding ASCII
}
$config = Read-EnvFile $EnvFile
$port = if ($config["PORT"]) { $config["PORT"] } else { "8090" }
$pgPassword = ([regex]::Match($config["DATABASE_URL"], "^postgres://postgres:([^@]+)@")).Groups[1].Value
if (-not $pgPassword) { throw "DATABASE_URL in $EnvFile must look like postgres://postgres:PASSWORD@127.0.0.1:5432/$Database" }

# --- Software (normally already there from HIMT-LMS) ---

Step "Checking IIS"
Install-WindowsFeature Web-Server -IncludeManagementTools | Out-Null

if (-not (Has choco)) {
  Step "Installing Chocolatey (Windows package installer)"
  Set-ExecutionPolicy Bypass -Scope Process -Force
  Invoke-Expression ((New-Object Net.WebClient).DownloadString("https://community.chocolatey.org/install.ps1"))
  Refresh-Path
}

$needed = @()
if (-not (Has git)) { $needed += "git" }
if (-not (Has nssm)) { $needed += "nssm" }
if (-not (Test-Path "$env:windir\system32\inetsrv\rewrite.dll")) { $needed += "urlrewrite" }
if (-not (Test-Path "$env:ProgramFiles\IIS\Application Request Routing")) { $needed += "iis-arr" }
if ($needed) {
  Step "Installing $($needed -join ', ')"
  Run choco (@("install", "-y", "--no-progress") + $needed)
  Add-MachinePath "C:\Program Files\Git\cmd"
}

if (-not (Test-Path "$PgBin\psql.exe")) {
  if ($pgPassword -eq "FILL_ME") { throw "PostgreSQL is not installed. Put a new password in DATABASE_URL in $EnvFile and run again." }
  Step "Installing PostgreSQL 17"
  Run choco @("install", "-y", "--no-progress", "postgresql17", "--params", "/Password:$pgPassword")
}
Add-MachinePath $PgBin

$nodeOk = (Has node) -and ((& node -v) -like "v24.*")
if (-not $nodeOk) {
  Step "Installing Node.js 24"
  $sums = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt").Content
  $msi = ([regex]::Match($sums, "node-v24[\d.]+-x64\.msi")).Value
  $msiPath = Join-Path $env:TEMP $msi
  Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/latest-v24.x/$msi" -OutFile $msiPath
  $install = Start-Process msiexec.exe -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait -PassThru
  if ($install.ExitCode -ne 0 -and $install.ExitCode -ne 3010) { throw "Node.js installer failed with exit code $($install.ExitCode)" }
  Refresh-Path
}

$missing = @("node", "git", "nssm") | Where-Object { -not (Has $_) }
if ($missing) { throw "Not found after install: $($missing -join ', '). Restart the server and run install.ps1 again." }

# --- Settings check ---

if ((Get-Content $EnvFile) -match "=FILL_ME|:FILL_ME@") {
  Write-Host ""
  Write-Host "Now fill in $EnvFile (Notepad is opening it), save, and run install.ps1 again." -ForegroundColor Yellow
  Write-Host "Still to fill in:" -ForegroundColor Yellow
  (Get-Content $EnvFile) -match "FILL_ME" | ForEach-Object { Write-Host "  $($_.Split('=')[0])" -ForegroundColor Yellow }
  Start-Process notepad.exe $EnvFile
  exit 0
}

# --- Code ---

Step "Getting the latest code"
if (Test-Path "$AppDir\.git") {
  Run git @("-C", $AppDir, "fetch", "origin", $Branch)
  Run git @("-C", $AppDir, "checkout", $Branch)
  Run git @("-C", $AppDir, "merge", "--ff-only", "origin/$Branch")
} else {
  Run git @("clone", "--branch", $Branch, $Repo, $AppDir)
}

Step "Installing packages and building"
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"
Run corepack @("enable")
Run corepack @("prepare", "pnpm@10.28.0", "--activate")
Refresh-Path
Push-Location $AppDir
try {
  Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
  Run pnpm @("install", "--frozen-lockfile")
  Run pnpm @("-r", "run", "build")
} finally {
  Pop-Location
}

# --- Database ---

Step "Preparing the $Database database"
$env:PGPASSWORD = $pgPassword
$exists = & "$PgBin\psql.exe" -U postgres -h 127.0.0.1 -tAc "SELECT 1 FROM pg_database WHERE datname='$Database'"
if ($LASTEXITCODE -ne 0) { throw "Could not sign in to PostgreSQL. Check the password in DATABASE_URL in $EnvFile." }
if ("$exists".Trim() -ne "1") {
  Run "$PgBin\createdb.exe" @("-U", "postgres", "-h", "127.0.0.1", $Database)
  if (Test-Path $DataFile) {
    Write-Host "Loading the old library data from $DataFile"
    Run "$PgBin\psql.exe" @("-U", "postgres", "-h", "127.0.0.1", "-d", $Database, "-q", "-v", "ON_ERROR_STOP=1", "-f", $DataFile)
    Move-Item -Force $DataFile (Join-Path $ConfigDir "library-data.loaded.sql")
  }
} elseif (Test-Path $DataFile) {
  Write-Host "The $Database database already exists, so $DataFile was not loaded." -ForegroundColor Yellow
}
# The app creates and updates its own tables when it starts.

# --- Windows service ---

Step "Setting up the $ServiceName service"
$listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  $ours = $owner -and $owner.CommandLine -like "*himt-library*"
  if (-not $ours) {
    $name = if ($owner) { "$($owner.Name) (process $($owner.ProcessId))" } else { "another program" }
    throw "Port $port is already used by $name. Set PORT in $EnvFile to a free port, such as 8095, and run again."
  }
}
New-Item -ItemType Directory -Force "$AppDir\logs" | Out-Null
if (-not (Get-Service $ServiceName -ErrorAction SilentlyContinue)) {
  Run nssm @("install", $ServiceName, (Get-Command node).Source)
}
Run nssm @("set", $ServiceName, "AppParameters", "--enable-source-maps $AppDir\server\dist\src\index.js")
Run nssm @("set", $ServiceName, "AppDirectory", "$AppDir\server")
Run nssm @("set", $ServiceName, "AppStdout", "$AppDir\logs\service.log")
Run nssm @("set", $ServiceName, "AppStderr", "$AppDir\logs\service.log")
Run nssm @("set", $ServiceName, "AppRotateFiles", "1")
Run nssm @("set", $ServiceName, "AppRotateBytes", "10485760")
Run nssm @("set", $ServiceName, "Start", "SERVICE_AUTO_START")
$environment = @($config.GetEnumerator() | Where-Object { $_.Value -ne "" -and $_.Key -notin @("SITE_HOST", "SITE_PORT") } | ForEach-Object { "$($_.Key)=$($_.Value)" })
$environment += "PATH=" + [Environment]::GetEnvironmentVariable("Path", "Machine")
New-ItemProperty -Force -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$ServiceName\Parameters" -Name AppEnvironmentExtra -PropertyType MultiString -Value $environment | Out-Null
Restart-Service $ServiceName -ErrorAction SilentlyContinue
if ((Get-Service $ServiceName).Status -ne "Running") { Start-Service $ServiceName }

$healthy = $false
for ($i = 0; $i -lt 30 -and -not $healthy; $i++) {
  Start-Sleep -Seconds 2
  try { $healthy = (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/api/healthz").StatusCode -eq 200 } catch { }
}
if (-not $healthy) { throw "The library did not start. See $AppDir\logs\service.log" }
Write-Host "The library is running on port $port."

# --- IIS ---

Step "Adding the $SiteName IIS site"
Import-Module WebAdministration
$appcmd = "$env:windir\system32\inetsrv\appcmd.exe"
# Same proxy settings as HIMT-LMS; setting them again changes nothing.
Run $appcmd @("set", "config", "-section:system.webServer/proxy", "/enabled:True", "/preserveHostHeader:True", "/reverseRewriteHostInResponseHeaders:False", "/commit:apphost")
$allowed = & $appcmd list config -section:system.webServer/rewrite/allowedServerVariables
if (-not ($allowed -match "HTTP_X_FORWARDED_PROTO")) {
  Run $appcmd @("set", "config", "-section:system.webServer/rewrite/allowedServerVariables", "/+[name='HTTP_X_FORWARDED_PROTO']", "/commit:apphost")
}
New-Item -ItemType Directory -Force $SiteDir | Out-Null
(Get-Content "$AppDir\deploy\windows\web.config" -Raw).Replace("127.0.0.1:8090", "127.0.0.1:$port") | Set-Content -Encoding UTF8 "$SiteDir\web.config"

$hostName = $config["SITE_HOST"]

# Ports already taken by other IIS sites or other programs.
function Port-Taken($candidate) {
  foreach ($other in Get-Website | Where-Object { $_.Name -ne $SiteName }) {
    foreach ($b in $other.Bindings.Collection) {
      $parts = $b.bindingInformation.Split(":")
      if ($parts[1] -eq "$candidate" -and (-not $hostName -or -not $parts[2] -or $parts[2] -eq $hostName)) { return $true }
    }
  }
  if ($hostName -and $candidate -eq 80) { return $false }
  $listener = Get-NetTCPConnection -State Listen -LocalPort $candidate -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -ne 4 }
  return [bool]$listener -or "$candidate" -eq "$port"
}

$site = Get-Website | Where-Object { $_.Name -eq $SiteName }
if ($hostName) {
  $sitePort = 80
} elseif ($config["SITE_PORT"]) {
  $sitePort = [int]$config["SITE_PORT"]
  if (Port-Taken $sitePort) { throw "Port $sitePort is already used. Change SITE_PORT in $EnvFile and run again." }
} else {
  # Keep the port from an earlier install if it is still free, else take the first free one.
  $sitePort = $null
  if ($site) {
    $current = [int]($site.Bindings.Collection[0].bindingInformation.Split(":")[1])
    if (-not (Port-Taken $current)) { $sitePort = $current }
  }
  if (-not $sitePort) { $sitePort = 8081..8099 | Where-Object { -not (Port-Taken $_) } | Select-Object -First 1 }
  if (-not $sitePort) { throw "No free port between 8081 and 8099. Set SITE_PORT in $EnvFile and run again." }
}
$binding = "*:${sitePort}:$hostName"
if ($site) { Stop-Website $SiteName -ErrorAction SilentlyContinue }
if (-not $site) {
  New-Website -Name $SiteName -Port $sitePort -HostHeader $hostName -PhysicalPath $SiteDir | Out-Null
} else {
  Set-ItemProperty "IIS:\Sites\$SiteName" -Name bindings -Value @{ protocol = "http"; bindingInformation = $binding }
}
Start-Website $SiteName

if (-not (Get-NetFirewallRule -DisplayName "HIMT-Library $sitePort" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "HIMT-Library $sitePort" -Direction Inbound -Protocol TCP -LocalPort $sitePort -Action Allow | Out-Null
}

$checkUrl = "http://127.0.0.1:$sitePort/api/healthz"
$headers = if ($hostName) { @{ Host = $hostName } } else { @{} }
$viaIis = $false
try { $viaIis = (Invoke-WebRequest -UseBasicParsing -Headers $headers $checkUrl).StatusCode -eq 200 } catch { }
if (-not $viaIis) { throw "IIS is not passing requests to the library. Check the $SiteName site in IIS Manager, then run again." }

Write-Host ""
if ($hostName) {
  Write-Host "Done. Open http://$hostName/ in a browser." -ForegroundColor Green
} else {
  Write-Host "Done. Open http://<this server's IP address>:$sitePort/ in a browser." -ForegroundColor Green
  Write-Host "If it does not open from outside, allow TCP port $sitePort in the MilesWeb firewall too." -ForegroundColor Green
}
Write-Host "Staff sign in at /staff/login with ADMIN_USERNAME and ADMIN_PASSWORD." -ForegroundColor Green
