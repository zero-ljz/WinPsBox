# Developer certificate, DNS diagnostics, and network intelligence helpers.

$script:LocalDevCaSubject = "CN=DevTools Box Local Root CA"
$script:LocalDevCaFriendlyName = "DevTools Box Local Root CA"
$script:LocalCertificateRoot = Join-Path $script:AppRoot "data\certificates"

function Initialize-LocalCertificateDirectory {
    [System.IO.Directory]::CreateDirectory($script:LocalCertificateRoot) | Out-Null
    return $script:LocalCertificateRoot
}

function Write-CertificatePem([System.Security.Cryptography.X509Certificates.X509Certificate2]$certificate, [string]$path) {
    $base64 = [Convert]::ToBase64String($certificate.RawData)
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add("-----BEGIN CERTIFICATE-----")
    for ($offset = 0; $offset -lt $base64.Length; $offset += 64) {
        $lines.Add($base64.Substring($offset, [math]::Min(64, $base64.Length - $offset)))
    }
    $lines.Add("-----END CERTIFICATE-----")
    [System.IO.File]::WriteAllText($path, ($lines -join "`r`n") + "`r`n", [System.Text.Encoding]::ASCII)
}

function Find-LocalDevCaPrivateCertificate {
    $now = Get-Date
    return Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Subject -eq $script:LocalDevCaSubject -and
            $_.HasPrivateKey -and
            $_.NotBefore -le $now -and
            $_.NotAfter -gt $now
        } |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1
}

function Test-CertificateStoreContains([string]$storePath, [string]$thumbprint) {
    if ([string]::IsNullOrWhiteSpace($thumbprint)) { return $false }
    return $null -ne (Get-ChildItem $storePath -ErrorAction SilentlyContinue |
        Where-Object { $_.Thumbprint -eq $thumbprint } |
        Select-Object -First 1)
}

function Get-LocalDevCertificateDefaults {
    $sans = [System.Collections.Generic.List[string]]::new()
    $sans.Add("localhost")
    $sans.Add("127.0.0.1")
    $sans.Add("::1")
    if (-not [string]::IsNullOrWhiteSpace($env:COMPUTERNAME)) {
        $sans.Add($env:COMPUTERNAME.ToLowerInvariant())
    }
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -ne "127.0.0.1" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.AddressState -eq "Preferred"
        } |
        ForEach-Object { $sans.Add($_.IPAddress) }

    return @{
        computerName = $env:COMPUTERNAME
        sans = @($sans | Select-Object -Unique)
        outputDirectory = (Initialize-LocalCertificateDirectory)
    }
}

function Get-LocalDevCaStatus {
    $ca = Find-LocalDevCaPrivateCertificate
    $trustedUser = $false
    $trustedMachine = $false
    if ($ca) {
        $trustedUser = Test-CertificateStoreContains -storePath "Cert:\CurrentUser\Root" -thumbprint $ca.Thumbprint
        $trustedMachine = Test-CertificateStoreContains -storePath "Cert:\LocalMachine\Root" -thumbprint $ca.Thumbprint
    }
    return @{
        exists = ($null -ne $ca)
        subject = if ($ca) { $ca.Subject } else { $script:LocalDevCaSubject }
        thumbprint = if ($ca) { $ca.Thumbprint } else { "" }
        validFrom = if ($ca) { $ca.NotBefore.ToString("yyyy-MM-dd HH:mm:ss") } else { "" }
        validTo = if ($ca) { $ca.NotAfter.ToString("yyyy-MM-dd HH:mm:ss") } else { "" }
        trustedCurrentUser = $trustedUser
        trustedLocalMachine = $trustedMachine
        outputDirectory = (Initialize-LocalCertificateDirectory)
        isAdmin = (Test-IsAdmin)
    }
}

function New-LocalDevRootCa([string]$trustScope = "CurrentUser") {
    try {
        $outputRoot = Initialize-LocalCertificateDirectory
        $ca = Find-LocalDevCaPrivateCertificate
        if (-not $ca) {
            $ca = New-SelfSignedCertificate `
                -Type Custom `
                -Subject $script:LocalDevCaSubject `
                -FriendlyName $script:LocalDevCaFriendlyName `
                -KeyAlgorithm RSA `
                -KeyLength 4096 `
                -HashAlgorithm SHA256 `
                -KeyExportPolicy Exportable `
                -KeyUsage CertSign, CRLSign, DigitalSignature `
                -CertStoreLocation "Cert:\CurrentUser\My" `
                -NotAfter (Get-Date).AddYears(10) `
                -TextExtension @("2.5.29.19={critical}{text}ca=1&pathlength=1") `
                -ErrorAction Stop
        }

        $cerPath = Join-Path $outputRoot "devtools-box-local-root-ca.cer"
        $pemPath = Join-Path $outputRoot "devtools-box-local-root-ca.pem"
        Export-Certificate -Cert $ca -FilePath $cerPath -Force -ErrorAction Stop | Out-Null
        Write-CertificatePem -certificate $ca -path $pemPath

        if ($trustScope -eq "LocalMachine") {
            if (Test-IsAdmin) {
                Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\LocalMachine\Root" -ErrorAction Stop | Out-Null
            }
            else {
                $safePath = $cerPath.Replace("'", "''")
                $command = "Import-Certificate -FilePath '$safePath' -CertStoreLocation 'Cert:\LocalMachine\Root' -ErrorAction Stop | Out-Null"
                $elevated = Invoke-ElevatedCommand -scriptBlockText $command
                if (-not $elevated.success) { throw $elevated.error }
            }
        }
        else {
            Import-Certificate -FilePath $cerPath -CertStoreLocation "Cert:\CurrentUser\Root" -ErrorAction Stop | Out-Null
        }

        return @{
            success = $true
            created = $true
            trustScope = $trustScope
            cerPath = $cerPath
            pemPath = $pemPath
            status = (Get-LocalDevCaStatus)
        }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function ConvertTo-ValidatedSanEntries($sanEntries) {
    $result = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($raw in @($sanEntries)) {
        $value = ([string]$raw).Trim()
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        $ip = $null
        if ([System.Net.IPAddress]::TryParse($value, [ref]$ip)) {
            $result.Add([PSCustomObject]@{ type = "IP"; value = $ip.ToString() })
            continue
        }
        if ($value.Length -gt 253 -or $value -notmatch '^(\*\.)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$') {
            throw "Invalid SAN entry: $value"
        }
        $result.Add([PSCustomObject]@{ type = "DNS"; value = $value.ToLowerInvariant() })
    }
    return @($result | Sort-Object -Property type, value -Unique)
}

function New-LocalDevServerCertificate([string]$commonName, $sanEntries, [int]$validDays = 825, [string]$pfxPassword) {
    try {
        $ca = Find-LocalDevCaPrivateCertificate
        if (-not $ca) { throw "Create the local Root CA first." }
        if ([string]::IsNullOrWhiteSpace($pfxPassword) -or $pfxPassword.Length -lt 6) {
            throw "PFX password must contain at least 6 characters."
        }

        $sans = ConvertTo-ValidatedSanEntries -sanEntries $sanEntries
        if ($sans.Count -eq 0) { throw "At least one SAN entry is required." }
        if ([string]::IsNullOrWhiteSpace($commonName)) {
            $commonName = [string]$sans[0].value
        }
        if ($commonName -match '[,=+<>#;"\\]') { throw "Common Name contains unsupported characters." }

        $validDays = [math]::Min([math]::Max($validDays, 1), 825)
        $sanParts = foreach ($san in $sans) {
            if ($san.type -eq "IP") { "ipaddress=$($san.value)" } else { "dns=$($san.value)" }
        }
        $certificate = New-SelfSignedCertificate `
            -Type Custom `
            -Subject "CN=$commonName" `
            -FriendlyName "DevTools Box - $commonName" `
            -Signer $ca `
            -KeyAlgorithm RSA `
            -KeyLength 2048 `
            -HashAlgorithm SHA256 `
            -KeyExportPolicy Exportable `
            -KeyUsage DigitalSignature, KeyEncipherment `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -NotAfter (Get-Date).AddDays($validDays) `
            -TextExtension @(
                "2.5.29.19={critical}{text}ca=0",
                "2.5.29.17={text}$($sanParts -join '&')",
                "2.5.29.37={text}1.3.6.1.5.5.7.3.1"
            ) `
            -ErrorAction Stop

        $safeName = ($commonName -replace '[^a-zA-Z0-9._-]', '-')
        $folder = Join-Path (Initialize-LocalCertificateDirectory) ("$safeName-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
        [System.IO.Directory]::CreateDirectory($folder) | Out-Null
        $pfxPath = Join-Path $folder "$safeName.pfx"
        $cerPath = Join-Path $folder "$safeName.cer"
        $pemPath = Join-Path $folder "$safeName.pem"
        $chainPath = Join-Path $folder "$safeName-chain.pem"
        $securePassword = ConvertTo-SecureString -String $pfxPassword -AsPlainText -Force

        Export-PfxCertificate -Cert $certificate -FilePath $pfxPath -Password $securePassword -ChainOption BuildChain -Force -ErrorAction Stop | Out-Null
        Export-Certificate -Cert $certificate -FilePath $cerPath -Force -ErrorAction Stop | Out-Null
        Write-CertificatePem -certificate $certificate -path $pemPath
        $leafPem = [System.IO.File]::ReadAllText($pemPath, [System.Text.Encoding]::ASCII)
        $rootPemPath = Join-Path (Initialize-LocalCertificateDirectory) "devtools-box-local-root-ca.pem"
        if (-not (Test-Path $rootPemPath)) { Write-CertificatePem -certificate $ca -path $rootPemPath }
        $rootPem = [System.IO.File]::ReadAllText($rootPemPath, [System.Text.Encoding]::ASCII)
        [System.IO.File]::WriteAllText($chainPath, $leafPem + $rootPem, [System.Text.Encoding]::ASCII)

        return @{
            success = $true
            commonName = $commonName
            thumbprint = $certificate.Thumbprint
            issuer = $certificate.Issuer
            validFrom = $certificate.NotBefore.ToString("yyyy-MM-dd HH:mm:ss")
            validTo = $certificate.NotAfter.ToString("yyyy-MM-dd HH:mm:ss")
            sans = @($sans)
            folder = $folder
            pfxPath = $pfxPath
            cerPath = $cerPath
            pemPath = $pemPath
            chainPath = $chainPath
        }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Open-LocalCertificateFolder([string]$path = "") {
    try {
        $target = if ([string]::IsNullOrWhiteSpace($path)) { Initialize-LocalCertificateDirectory } else { $path }
        $root = [System.IO.Path]::GetFullPath((Initialize-LocalCertificateDirectory)).TrimEnd('\') + '\'
        $resolved = [System.IO.Path]::GetFullPath($target)
        if (-not ($resolved + '\').StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and $resolved -ne $root.TrimEnd('\')) {
            throw "Certificate folder is outside the managed output directory."
        }
        Start-Process explorer.exe -ArgumentList "/select,`"$resolved`"" -ErrorAction Stop
        return @{ success = $true; path = $resolved }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Convert-DnsRecordToResult($record) {
    $typeName = [string]$record.Type
    $value = switch ($typeName) {
        "A" { [string]$record.IPAddress }
        "AAAA" { [string]$record.IPAddress }
        "CNAME" { [string]$record.NameHost }
        "PTR" { [string]$record.NameHost }
        "MX" { "$($record.Preference) $($record.NameExchange)" }
        "TXT" { (@($record.Strings) -join "") }
        "NS" { [string]$record.NameHost }
        "SOA" { "$($record.PrimaryServer) $($record.NameAdministrator) serial=$($record.SerialNumber)" }
        "SRV" { "$($record.Priority) $($record.Weight) $($record.Port) $($record.NameTarget)" }
        "CAA" { "$($record.Flags) $($record.Tag) $($record.Value)" }
        default {
            if ($record.IPAddress) { [string]$record.IPAddress }
            elseif ($record.NameHost) { [string]$record.NameHost }
            else { [string]$record }
        }
    }
    return [PSCustomObject]@{
        name = [string]$record.Name
        type = $typeName
        ttl = if ($null -ne $record.TTL) { [int64]$record.TTL } else { 0 }
        section = [string]$record.Section
        value = $value
    }
}

function Get-DnsPacketUInt16([byte[]]$bytes, [int]$offset) {
    return ([int]$bytes[$offset] -shl 8) -bor [int]$bytes[$offset + 1]
}

function Get-DnsPacketUInt32([byte[]]$bytes, [int]$offset) {
    return ([uint32]$bytes[$offset] -shl 24) -bor ([uint32]$bytes[$offset + 1] -shl 16) -bor ([uint32]$bytes[$offset + 2] -shl 8) -bor [uint32]$bytes[$offset + 3]
}

function Read-DnsPacketName([byte[]]$bytes, [ref]$offset) {
    $labels = [System.Collections.Generic.List[string]]::new()
    $position = [int]$offset.Value
    $jumped = $false
    $guard = 0
    while ($position -lt $bytes.Length -and $guard++ -lt 128) {
        $length = [int]$bytes[$position]
        if (($length -band 0xC0) -eq 0xC0) {
            if ($position + 1 -ge $bytes.Length) { throw "Invalid DNS compression pointer." }
            $pointer = (($length -band 0x3F) -shl 8) -bor [int]$bytes[$position + 1]
            if (-not $jumped) { $offset.Value = $position + 2 }
            $position = $pointer
            $jumped = $true
            continue
        }
        if ($length -eq 0) {
            if (-not $jumped) { $offset.Value = $position + 1 }
            break
        }
        $position++
        if ($position + $length -gt $bytes.Length) { throw "Invalid DNS label length." }
        $labels.Add([Text.Encoding]::ASCII.GetString($bytes, $position, $length))
        $position += $length
        if (-not $jumped) { $offset.Value = $position }
    }
    return ($labels -join ".")
}

function Invoke-RawCaaDnsQuery([string]$name, [string]$server) {
    $packet = [System.Collections.Generic.List[byte]]::new()
    $queryId = Get-Random -Minimum 1 -Maximum 65535
    foreach ($byte in @(
        (($queryId -shr 8) -band 0xFF), ($queryId -band 0xFF),
        0x01, 0x00,
        0x00, 0x01,
        0x00, 0x00,
        0x00, 0x00,
        0x00, 0x00
    )) { $packet.Add([byte]$byte) }
    foreach ($label in $name.TrimEnd('.').Split('.')) {
        $labelBytes = [Text.Encoding]::ASCII.GetBytes($label)
        if ($labelBytes.Length -lt 1 -or $labelBytes.Length -gt 63) { throw "Invalid DNS label." }
        $packet.Add([byte]$labelBytes.Length)
        $packet.AddRange($labelBytes)
    }
    $packet.Add(0)
    $packet.Add(0x01)
    $packet.Add(0x01)
    $packet.Add(0x00)
    $packet.Add(0x01)

    $client = New-Object System.Net.Sockets.UdpClient
    try {
        $client.Client.ReceiveTimeout = 2500
        $client.Connect($server, 53)
        [byte[]]$requestBytes = $packet.ToArray()
        [void]$client.Send($requestBytes, $requestBytes.Length)
        $remote = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
        [byte[]]$response = $client.Receive([ref]$remote)
    }
    finally {
        $client.Close()
    }

    if ($response.Length -lt 12 -or (Get-DnsPacketUInt16 $response 0) -ne $queryId) { throw "Invalid DNS response." }
    $responseCode = [int]$response[3] -band 0x0F
    if ($responseCode -ne 0) { throw "DNS server returned status $responseCode." }
    $questionCount = Get-DnsPacketUInt16 $response 4
    $answerCount = Get-DnsPacketUInt16 $response 6
    $offset = 12
    for ($index = 0; $index -lt $questionCount; $index++) {
        [void](Read-DnsPacketName -bytes $response -offset ([ref]$offset))
        $offset += 4
    }

    $records = [System.Collections.Generic.List[PSCustomObject]]::new()
    for ($index = 0; $index -lt $answerCount; $index++) {
        $recordName = Read-DnsPacketName -bytes $response -offset ([ref]$offset)
        if ($offset + 10 -gt $response.Length) { throw "Truncated DNS answer." }
        $recordType = Get-DnsPacketUInt16 $response $offset
        $ttl = Get-DnsPacketUInt32 $response ($offset + 4)
        $dataLength = Get-DnsPacketUInt16 $response ($offset + 8)
        $dataOffset = $offset + 10
        $offset = $dataOffset + $dataLength
        if ($offset -gt $response.Length) { throw "Truncated DNS record data." }
        if ($recordType -eq 257 -and $dataLength -ge 2) {
            $flags = [int]$response[$dataOffset]
            $tagLength = [int]$response[$dataOffset + 1]
            if ($tagLength + 2 -le $dataLength) {
                $tag = [Text.Encoding]::ASCII.GetString($response, $dataOffset + 2, $tagLength)
                $valueLength = $dataLength - $tagLength - 2
                $value = if ($valueLength -gt 0) { [Text.Encoding]::ASCII.GetString($response, $dataOffset + 2 + $tagLength, $valueLength) } else { "" }
                $records.Add([PSCustomObject]@{ name = $recordName; type = "CAA"; ttl = [int64]$ttl; section = "Answer"; value = "$flags $tag $value" })
            }
        }
    }
    return @($records)
}

function Invoke-StandardDnsQuery([string]$name, [string]$recordType = "A", [string]$server = "") {
    $allowed = @("A", "AAAA", "CNAME", "MX", "TXT", "NS", "SOA", "SRV", "CAA")
    $types = if ($recordType -eq "ALL") { $allowed } elseif ($allowed -contains $recordType) { @($recordType) } else { throw "Unsupported DNS record type." }
    $records = [System.Collections.Generic.List[PSCustomObject]]::new()
    $errors = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($type in $types) {
        try {
            if ($type -eq "CAA") {
                $queryServer = $server
                if ([string]::IsNullOrWhiteSpace($queryServer)) {
                    $queryServer = Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                        Where-Object { $_.ServerAddresses.Count -gt 0 } |
                        ForEach-Object { $_.ServerAddresses } |
                        Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' } |
                        Select-Object -First 1
                    if ([string]::IsNullOrWhiteSpace($queryServer)) { $queryServer = "1.1.1.1" }
                }
                Invoke-RawCaaDnsQuery -name $name -server $queryServer | ForEach-Object { $records.Add($_) }
                continue
            }
            $params = @{ Name = $name; Type = $type; DnsOnly = $true; NoHostsFile = $true; QuickTimeout = $true; ErrorAction = "Stop" }
            if (-not [string]::IsNullOrWhiteSpace($server)) { $params.Server = $server }
            Resolve-DnsName @params | Where-Object { $_.Section -eq "Answer" -or $_.Type -eq $type } | ForEach-Object {
                $records.Add((Convert-DnsRecordToResult $_))
            }
        }
        catch {
            $errors.Add([PSCustomObject]@{ type = $type; error = $_.Exception.Message })
        }
    }
    return @{ records = @($records); errors = @($errors) }
}

function Get-DnsJsonTypeName([int]$typeNumber) {
    $map = @{ 1 = "A"; 2 = "NS"; 5 = "CNAME"; 6 = "SOA"; 15 = "MX"; 16 = "TXT"; 28 = "AAAA"; 33 = "SRV"; 257 = "CAA" }
    if ($map.ContainsKey($typeNumber)) { return $map[$typeNumber] }
    return [string]$typeNumber
}

function Invoke-DnsProviderComparison([string]$name, [string]$recordType = "A") {
    $providers = @(
        @{ name = "114 DNS"; server = "114.114.114.114" },
        @{ name = "AliDNS"; server = "223.5.5.5" },
        @{ name = "Google"; server = "8.8.8.8" },
        @{ name = "Cloudflare"; server = "1.1.1.1" }
    )
    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($provider in $providers) {
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $result = Invoke-StandardDnsQuery -name $name -recordType $recordType -server $provider.server
            $watch.Stop()
            $answers = @($result.records | ForEach-Object { $_.value } | Sort-Object -Unique)
            $results.Add([PSCustomObject]@{
                name = $provider.name
                server = $provider.server
                success = ($answers.Count -gt 0)
                latencyMs = [math]::Round($watch.Elapsed.TotalMilliseconds, 1)
                answers = $answers
                records = $result.records
                error = if ($answers.Count -eq 0 -and $result.errors.Count) { $result.errors[0].error } else { "" }
            })
        }
        catch {
            $watch.Stop()
            $results.Add([PSCustomObject]@{ name = $provider.name; server = $provider.server; success = $false; latencyMs = [math]::Round($watch.Elapsed.TotalMilliseconds, 1); answers = @(); records = @(); error = $_.Exception.Message })
        }
    }

    $successful = @($results | Where-Object { $_.success })
    $groups = @($successful | Group-Object { (@($_.answers) -join "|") } | Sort-Object Count -Descending)
    $consensus = if ($groups.Count) { @($groups[0].Group[0].answers) } else { @() }
    return @{
        providers = @($results)
        mismatch = ($groups.Count -gt 1)
        consensusAnswers = $consensus
        consensusCount = if ($groups.Count) { $groups[0].Count } else { 0 }
        respondingCount = $successful.Count
    }
}

function Invoke-DohProviderComparison([string]$name, [string]$recordType = "A") {
    $safeName = [Uri]::EscapeDataString($name)
    $safeType = [Uri]::EscapeDataString($recordType)
    $providers = @(
        @{ name = "Cloudflare DoH"; url = "https://cloudflare-dns.com/dns-query?name=$safeName&type=$safeType" },
        @{ name = "Google DoH"; url = "https://dns.google/resolve?name=$safeName&type=$safeType" },
        @{ name = "AliDNS DoH"; url = "https://dns.alidns.com/resolve?name=$safeName&type=$safeType" }
    )
    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($provider in $providers) {
        $watch = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $response = Invoke-RestMethod -Uri $provider.url -Headers @{ Accept = "application/dns-json"; "User-Agent" = "DevToolsBox/1.0" } -TimeoutSec 8 -ErrorAction Stop
            $watch.Stop()
            $answers = @($response.Answer | ForEach-Object {
                [PSCustomObject]@{ name = [string]$_.name; type = (Get-DnsJsonTypeName ([int]$_.type)); ttl = [int64]$_.TTL; value = [string]$_.data }
            })
            $results.Add([PSCustomObject]@{
                name = $provider.name
                endpoint = $provider.url.Split('?')[0]
                success = ([int]$response.Status -eq 0)
                status = [int]$response.Status
                latencyMs = [math]::Round($watch.Elapsed.TotalMilliseconds, 1)
                answers = $answers
                error = ""
            })
        }
        catch {
            $watch.Stop()
            $results.Add([PSCustomObject]@{ name = $provider.name; endpoint = $provider.url.Split('?')[0]; success = $false; status = -1; latencyMs = [math]::Round($watch.Elapsed.TotalMilliseconds, 1); answers = @(); error = $_.Exception.Message })
        }
    }
    return @($results)
}

function Invoke-DeepDnsDiagnostic([string]$name, [string]$recordType = "A") {
    if ([string]::IsNullOrWhiteSpace($name) -or $name.Length -gt 253) { return @{ success = $false; error = "Invalid DNS name." } }
    try {
        $name = $name.Trim().TrimEnd('.')
        $standard = Invoke-StandardDnsQuery -name $name -recordType $recordType
        $compareType = if ($recordType -eq "ALL") { "A" } else { $recordType }
        $comparison = Invoke-DnsProviderComparison -name $name -recordType $compareType
        $doh = Invoke-DohProviderComparison -name $name -recordType $compareType
        return @{
            success = $true
            name = $name
            recordType = $recordType
            records = $standard.records
            recordErrors = $standard.errors
            comparison = $comparison
            doh = $doh
            diagnosedAt = [DateTime]::Now.ToString("yyyy-MM-dd HH:mm:ss")
        }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}

function Get-RdapEntityName($entity) {
    try {
        foreach ($entry in @($entity.vcardArray[1])) {
            if ($entry[0] -eq "fn") { return [string]$entry[3] }
        }
    } catch { }
    return ""
}

function Convert-RdapResult($rdap, [string]$kind) {
    if (-not $rdap) { return $null }
    $events = @{}
    foreach ($event in @($rdap.events)) { $events[[string]$event.eventAction] = [string]$event.eventDate }
    $entities = @($rdap.entities | ForEach-Object {
        [PSCustomObject]@{ handle = [string]$_.handle; name = (Get-RdapEntityName $_); roles = @($_.roles) }
    })
    if ($kind -eq "domain") {
        return [PSCustomObject]@{
            kind = "domain"
            handle = [string]$rdap.handle
            name = [string]$rdap.ldhName
            unicodeName = [string]$rdap.unicodeName
            status = @($rdap.status)
            registrar = [string](($entities | Where-Object { $_.roles -contains "registrar" } | Select-Object -First 1).name)
            registeredAt = [string]$events["registration"]
            expiresAt = [string]$events["expiration"]
            changedAt = [string]$events["last changed"]
            nameservers = @($rdap.nameservers | ForEach-Object { $_.ldhName })
            dnssec = [bool]$rdap.secureDNS.delegationSigned
            entities = $entities
        }
    }
    return [PSCustomObject]@{
        kind = "network"
        handle = [string]$rdap.handle
        name = [string]$rdap.name
        type = [string]$rdap.type
        country = [string]$rdap.country
        startAddress = [string]$rdap.startAddress
        endAddress = [string]$rdap.endAddress
        status = @($rdap.status)
        changedAt = [string]$events["last changed"]
        entities = $entities
    }
}

function Get-IpClassification([System.Net.IPAddress]$ip, [int64]$asn, [string]$organization, [string]$networkDomain) {
    if ([System.Net.IPAddress]::IsLoopback($ip) -or $ip.IsIPv6LinkLocal -or $ip.IsIPv6SiteLocal) {
        return @{ code = "private"; confidence = "high"; reasons = @("Loopback or local address") }
    }
    if ($ip.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
        $bytes = $ip.GetAddressBytes()
        if ($bytes[0] -eq 10 -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168)) {
            return @{ code = "private"; confidence = "high"; reasons = @("RFC1918 private address") }
        }
    }

    $text = ("$organization $networkDomain").ToLowerInvariant()
    $cdnAsns = @(13335, 20940, 54113, 15169)
    $cloudAsns = @(16509, 14618, 8075, 14061, 45102, 45090, 55990, 63949, 24940)
    $residentialAsns = @(4134, 4837, 9808, 4812, 17621, 9929)
    if ($text -match 'vpn|proxy|privacy|tunnel|anonymous') { return @{ code = "proxy"; confidence = "medium"; reasons = @("Organization keywords indicate proxy or VPN infrastructure") } }
    if ($cdnAsns -contains $asn -or $text -match 'cloudflare|akamai|fastly|cdn') { return @{ code = "cdn"; confidence = "high"; reasons = @("ASN or organization matches a known CDN") } }
    if ($cloudAsns -contains $asn -or $text -match 'cloud|hosting|datacenter|data center|server|colo|amazon|microsoft|digitalocean|alibaba|tencent') { return @{ code = "datacenter"; confidence = "medium"; reasons = @("ASN or organization matches hosting infrastructure") } }
    if ($residentialAsns -contains $asn -or $text -match 'telecom|unicom|mobile|broadband|cable|residential|communications') { return @{ code = "residential"; confidence = "medium"; reasons = @("ASN or organization matches a consumer ISP") } }
    return @{ code = "unknown"; confidence = "low"; reasons = @("No strong infrastructure signal was found") }
}

function Invoke-NetworkJsonRequest([string]$url) {
    return Invoke-RestMethod -Uri $url -Headers @{ "User-Agent" = "DevToolsBox/1.0"; Accept = "application/json" } -TimeoutSec 12 -ErrorAction Stop
}

function Get-NetworkIntelligence([string]$target) {
    if ([string]::IsNullOrWhiteSpace($target)) { return @{ success = $false; error = "IP address or domain is required." } }
    $target = $target.Trim().TrimEnd('.')
    $parsedIp = $null
    $isIp = [System.Net.IPAddress]::TryParse($target, [ref]$parsedIp)
    $domain = if ($isIp) { "" } else { $target.ToLowerInvariant() }
    try {
        $addresses = if ($isIp) { @($parsedIp) } else { @([System.Net.Dns]::GetHostAddresses($domain)) }
        if ($addresses.Count -eq 0) { throw "The domain did not resolve to an IP address." }
        $primaryIp = @($addresses | Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } | Select-Object -First 1)
        if (-not $primaryIp.Count) { $primaryIp = @($addresses | Select-Object -First 1) }
        $ip = $primaryIp[0]
        $isLocal = (Get-IpClassification -ip $ip -asn 0 -organization "" -networkDomain "").code -eq "private"

        $geo = $null
        $ripe = $null
        $rdapNetwork = $null
        $rdapDomain = $null
        $sourceErrors = [System.Collections.Generic.List[PSCustomObject]]::new()
        if (-not $isLocal) {
            try { $geo = Invoke-NetworkJsonRequest -url ("https://ipwho.is/" + [Uri]::EscapeDataString($ip.ToString())) } catch { $sourceErrors.Add([PSCustomObject]@{ source = "ipwho.is"; error = $_.Exception.Message }) }
            try { $ripe = Invoke-NetworkJsonRequest -url ("https://stat.ripe.net/data/prefix-overview/data.json?resource=" + [Uri]::EscapeDataString($ip.ToString())) } catch { $sourceErrors.Add([PSCustomObject]@{ source = "RIPE Stat"; error = $_.Exception.Message }) }
            try { $rdapNetwork = Invoke-NetworkJsonRequest -url ("https://rdap.org/ip/" + [Uri]::EscapeDataString($ip.ToString())) } catch { $sourceErrors.Add([PSCustomObject]@{ source = "RDAP IP"; error = $_.Exception.Message }) }
        }
        if ($domain) {
            try { $rdapDomain = Invoke-NetworkJsonRequest -url ("https://rdap.org/domain/" + [Uri]::EscapeDataString($domain)) } catch { $sourceErrors.Add([PSCustomObject]@{ source = "RDAP Domain"; error = $_.Exception.Message }) }
        }

        [int64]$asn = 0
        $organization = ""
        $isp = ""
        $networkDomain = ""
        if ($geo -and $geo.connection) {
            $asnText = ([string]$geo.connection.asn) -replace '[^0-9]', ''
            [void][int64]::TryParse($asnText, [ref]$asn)
            $organization = [string]$geo.connection.org
            $isp = [string]$geo.connection.isp
            $networkDomain = [string]$geo.connection.domain
        }
        $ripeAsn = if ($ripe -and @($ripe.data.asns).Count) { @($ripe.data.asns)[0] } else { $null }
        if ($asn -eq 0 -and $ripeAsn) {
            $asn = if ($null -ne $ripeAsn.asn) { [int64]$ripeAsn.asn } else { [int64]$ripeAsn }
        }
        if (-not $organization -and $ripeAsn -and $ripeAsn.holder) { $organization = [string]$ripeAsn.holder }
        $classification = Get-IpClassification -ip $ip -asn $asn -organization $organization -networkDomain $networkDomain

        return @{
            success = $true
            query = $target
            queryType = if ($isIp) { "ip" } else { "domain" }
            domain = $domain
            primaryIp = $ip.ToString()
            resolvedIps = @($addresses | ForEach-Object { $_.ToString() })
            geo = if ($geo) { @{
                country = [string]$geo.country
                countryCode = [string]$geo.country_code
                region = [string]$geo.region
                city = [string]$geo.city
                postal = [string]$geo.postal
                latitude = $geo.latitude
                longitude = $geo.longitude
                timezone = [string]$geo.timezone.id
            } } else { $null }
            network = @{
                asn = $asn
                organization = $organization
                isp = $isp
                domain = $networkDomain
                prefix = if ($ripe) { [string]$ripe.data.resource } else { "" }
                holder = if ($ripeAsn -and $ripeAsn.holder) { [string]$ripeAsn.holder } else { "" }
                announced = if ($ripe) { [bool]$ripe.data.announced } else { $false }
            }
            classification = $classification
            domainRdap = (Convert-RdapResult -rdap $rdapDomain -kind "domain")
            networkRdap = (Convert-RdapResult -rdap $rdapNetwork -kind "network")
            sourceErrors = @($sourceErrors)
            queriedAt = [DateTime]::Now.ToString("yyyy-MM-dd HH:mm:ss")
        }
    }
    catch {
        return @{ success = $false; error = $_.Exception.Message }
    }
}
