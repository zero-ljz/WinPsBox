# Wi-Fi analysis and HTTP redirect tracing helpers.

function Initialize-WifiScannerType {
    if ('WinPsBoxWifiScanner' -as [type]) { return }

    $source = @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public sealed class WinPsBoxWifiInterface
{
    public string Id { get; set; }
    public string Name { get; set; }
    public string State { get; set; }
}

public sealed class WinPsBoxWifiNetwork
{
    public string InterfaceId { get; set; }
    public string InterfaceName { get; set; }
    public string Ssid { get; set; }
    public string Bssid { get; set; }
    public int SignalQuality { get; set; }
    public int Rssi { get; set; }
    public int FrequencyMHz { get; set; }
    public int Channel { get; set; }
    public string Band { get; set; }
    public string RadioType { get; set; }
    public string Authentication { get; set; }
    public string Cipher { get; set; }
    public string ProfileName { get; set; }
    public bool SecurityEnabled { get; set; }
    public bool Connected { get; set; }
    public bool Connectable { get; set; }
}

public sealed class WinPsBoxWifiScanResult
{
    public WinPsBoxWifiInterface[] Interfaces { get; set; }
    public WinPsBoxWifiNetwork[] Networks { get; set; }
}

public static class WinPsBoxWifiScanner
{
    private const uint WLAN_CLIENT_VERSION_LONGHORN = 2;
    private const uint WLAN_AVAILABLE_NETWORK_INCLUDE_ALL_ADHOC_PROFILES = 0x1;
    private const uint WLAN_AVAILABLE_NETWORK_INCLUDE_ALL_MANUAL_HIDDEN_PROFILES = 0x2;
    private const uint WLAN_AVAILABLE_NETWORK_CONNECTED = 0x1;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WLAN_INTERFACE_INFO
    {
        public Guid InterfaceGuid;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string Description;
        public int State;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct DOT11_SSID
    {
        public uint Length;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
        public byte[] Ssid;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WLAN_AVAILABLE_NETWORK
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string ProfileName;
        public DOT11_SSID Dot11Ssid;
        public int BssType;
        public uint NumberOfBssids;
        [MarshalAs(UnmanagedType.Bool)]
        public bool NetworkConnectable;
        public uint NotConnectableReason;
        public uint NumberOfPhyTypes;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 8)]
        public uint[] PhyTypes;
        [MarshalAs(UnmanagedType.Bool)]
        public bool MorePhyTypes;
        public uint SignalQuality;
        [MarshalAs(UnmanagedType.Bool)]
        public bool SecurityEnabled;
        public uint DefaultAuthAlgorithm;
        public uint DefaultCipherAlgorithm;
        public uint Flags;
        public uint Reserved;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WLAN_RATE_SET
    {
        public uint RateSetLength;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 126)]
        public ushort[] RateSet;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WLAN_BSS_ENTRY
    {
        public DOT11_SSID Dot11Ssid;
        public uint PhyId;
        [MarshalAs(UnmanagedType.ByValArray, SizeConst = 6)]
        public byte[] Bssid;
        public int BssType;
        public int BssPhyType;
        public int Rssi;
        public uint LinkQuality;
        [MarshalAs(UnmanagedType.U1)]
        public bool InRegDomain;
        public ushort BeaconPeriod;
        public ulong Timestamp;
        public ulong HostTimestamp;
        public ushort CapabilityInformation;
        public uint CenterFrequency;
        public WLAN_RATE_SET RateSet;
        public uint IeOffset;
        public uint IeSize;
    }

    [DllImport("wlanapi.dll")]
    private static extern uint WlanOpenHandle(uint clientVersion, IntPtr reserved, out uint negotiatedVersion, out IntPtr clientHandle);

    [DllImport("wlanapi.dll")]
    private static extern uint WlanCloseHandle(IntPtr clientHandle, IntPtr reserved);

    [DllImport("wlanapi.dll")]
    private static extern uint WlanEnumInterfaces(IntPtr clientHandle, IntPtr reserved, out IntPtr interfaceList);

    [DllImport("wlanapi.dll")]
    private static extern uint WlanGetAvailableNetworkList(IntPtr clientHandle, ref Guid interfaceGuid, uint flags, IntPtr reserved, out IntPtr networkList);

    [DllImport("wlanapi.dll")]
    private static extern uint WlanGetNetworkBssList(IntPtr clientHandle, ref Guid interfaceGuid, IntPtr ssid, int bssType, bool securityEnabled, IntPtr reserved, out IntPtr bssList);

    [DllImport("wlanapi.dll")]
    private static extern void WlanFreeMemory(IntPtr memory);

    public static WinPsBoxWifiScanResult Scan()
    {
        IntPtr handle = IntPtr.Zero;
        IntPtr interfaceList = IntPtr.Zero;
        uint negotiatedVersion;
        uint result = WlanOpenHandle(WLAN_CLIENT_VERSION_LONGHORN, IntPtr.Zero, out negotiatedVersion, out handle);
        if (result != 0) throw new Win32Exception((int)result);

        try
        {
            result = WlanEnumInterfaces(handle, IntPtr.Zero, out interfaceList);
            if (result != 0) throw new Win32Exception((int)result);

            int count = Marshal.ReadInt32(interfaceList, 0);
            int offset = 8;
            int interfaceSize = Marshal.SizeOf(typeof(WLAN_INTERFACE_INFO));
            var interfaces = new List<WinPsBoxWifiInterface>();
            var networks = new List<WinPsBoxWifiNetwork>();

            for (int index = 0; index < count; index++)
            {
                IntPtr itemPointer = IntPtr.Add(interfaceList, offset + index * interfaceSize);
                WLAN_INTERFACE_INFO info = (WLAN_INTERFACE_INFO)Marshal.PtrToStructure(itemPointer, typeof(WLAN_INTERFACE_INFO));
                interfaces.Add(new WinPsBoxWifiInterface {
                    Id = info.InterfaceGuid.ToString(),
                    Name = info.Description ?? string.Empty,
                    State = InterfaceState(info.State)
                });
                AddInterfaceNetworks(handle, info, networks);
            }

            return new WinPsBoxWifiScanResult { Interfaces = interfaces.ToArray(), Networks = networks.ToArray() };
        }
        finally
        {
            if (interfaceList != IntPtr.Zero) WlanFreeMemory(interfaceList);
            if (handle != IntPtr.Zero) WlanCloseHandle(handle, IntPtr.Zero);
        }
    }

    private static void AddInterfaceNetworks(IntPtr handle, WLAN_INTERFACE_INFO info, List<WinPsBoxWifiNetwork> target)
    {
        var available = ReadAvailableNetworks(handle, info.InterfaceGuid);
        IntPtr list = IntPtr.Zero;
        uint result = WlanGetNetworkBssList(handle, ref info.InterfaceGuid, IntPtr.Zero, 3, false, IntPtr.Zero, out list);
        if (result != 0) return;

        try
        {
            int count = Marshal.ReadInt32(list, 4);
            int offset = 8;
            int entrySize = Marshal.SizeOf(typeof(WLAN_BSS_ENTRY));
            for (int index = 0; index < count; index++)
            {
                IntPtr entryPointer = IntPtr.Add(list, offset + index * entrySize);
                WLAN_BSS_ENTRY entry = (WLAN_BSS_ENTRY)Marshal.PtrToStructure(entryPointer, typeof(WLAN_BSS_ENTRY));
                string ssid = SsidText(entry.Dot11Ssid);
                WLAN_AVAILABLE_NETWORK metadata;
                bool found = available.TryGetValue(ssid, out metadata);
                int frequencyMHz = (int)Math.Round(entry.CenterFrequency / 1000.0);
                target.Add(new WinPsBoxWifiNetwork {
                    InterfaceId = info.InterfaceGuid.ToString(),
                    InterfaceName = info.Description ?? string.Empty,
                    Ssid = ssid,
                    Bssid = MacText(entry.Bssid),
                    SignalQuality = (int)entry.LinkQuality,
                    Rssi = entry.Rssi,
                    FrequencyMHz = frequencyMHz,
                    Channel = ChannelFromFrequency(frequencyMHz),
                    Band = BandFromFrequency(frequencyMHz),
                    RadioType = PhyType((uint)entry.BssPhyType),
                    Authentication = found ? AuthAlgorithm(metadata.DefaultAuthAlgorithm) : "Unknown",
                    Cipher = found ? CipherAlgorithm(metadata.DefaultCipherAlgorithm) : "Unknown",
                    ProfileName = found ? (metadata.ProfileName ?? string.Empty) : string.Empty,
                    SecurityEnabled = found && metadata.SecurityEnabled,
                    Connected = found && (metadata.Flags & WLAN_AVAILABLE_NETWORK_CONNECTED) != 0,
                    Connectable = !found || metadata.NetworkConnectable
                });
            }
        }
        finally
        {
            if (list != IntPtr.Zero) WlanFreeMemory(list);
        }
    }

    private static Dictionary<string, WLAN_AVAILABLE_NETWORK> ReadAvailableNetworks(IntPtr handle, Guid interfaceGuid)
    {
        var resultMap = new Dictionary<string, WLAN_AVAILABLE_NETWORK>(StringComparer.Ordinal);
        IntPtr list = IntPtr.Zero;
        uint flags = WLAN_AVAILABLE_NETWORK_INCLUDE_ALL_ADHOC_PROFILES | WLAN_AVAILABLE_NETWORK_INCLUDE_ALL_MANUAL_HIDDEN_PROFILES;
        uint result = WlanGetAvailableNetworkList(handle, ref interfaceGuid, flags, IntPtr.Zero, out list);
        if (result != 0) return resultMap;

        try
        {
            int count = Marshal.ReadInt32(list, 0);
            int offset = 8;
            int entrySize = Marshal.SizeOf(typeof(WLAN_AVAILABLE_NETWORK));
            for (int index = 0; index < count; index++)
            {
                IntPtr entryPointer = IntPtr.Add(list, offset + index * entrySize);
                WLAN_AVAILABLE_NETWORK entry = (WLAN_AVAILABLE_NETWORK)Marshal.PtrToStructure(entryPointer, typeof(WLAN_AVAILABLE_NETWORK));
                string ssid = SsidText(entry.Dot11Ssid);
                if (!resultMap.ContainsKey(ssid) || (entry.Flags & WLAN_AVAILABLE_NETWORK_CONNECTED) != 0) resultMap[ssid] = entry;
            }
        }
        finally
        {
            if (list != IntPtr.Zero) WlanFreeMemory(list);
        }
        return resultMap;
    }

    private static string SsidText(DOT11_SSID value)
    {
        if (value.Ssid == null || value.Length == 0) return string.Empty;
        int length = Math.Min((int)value.Length, value.Ssid.Length);
        return Encoding.UTF8.GetString(value.Ssid, 0, length).TrimEnd('\0');
    }

    private static string MacText(byte[] value)
    {
        if (value == null || value.Length < 6) return string.Empty;
        return BitConverter.ToString(value, 0, 6).Replace('-', ':');
    }

    private static int ChannelFromFrequency(int frequencyMHz)
    {
        if (frequencyMHz == 2484) return 14;
        if (frequencyMHz >= 2412 && frequencyMHz <= 2472) return (frequencyMHz - 2407) / 5;
        if (frequencyMHz >= 5000 && frequencyMHz < 5925) return (frequencyMHz - 5000) / 5;
        if (frequencyMHz >= 5955 && frequencyMHz <= 7115) return (frequencyMHz - 5950) / 5;
        return 0;
    }

    private static string BandFromFrequency(int frequencyMHz)
    {
        if (frequencyMHz >= 2400 && frequencyMHz < 2500) return "2.4 GHz";
        if (frequencyMHz >= 4900 && frequencyMHz < 5925) return "5 GHz";
        if (frequencyMHz >= 5925 && frequencyMHz < 7200) return "6 GHz";
        return "Unknown";
    }

    private static string InterfaceState(int value)
    {
        switch (value) {
            case 1: return "Connected";
            case 2: return "AdHocNetworkFormed";
            case 3: return "Disconnecting";
            case 4: return "Disconnected";
            case 5: return "Associating";
            case 6: return "Discovering";
            case 7: return "Authenticating";
            default: return "NotReady";
        }
    }

    private static string PhyType(uint value)
    {
        switch (value) {
            case 1: return "802.11 FHSS";
            case 2: return "802.11 DSSS";
            case 4: return "802.11a";
            case 5: return "802.11b";
            case 6: return "802.11g";
            case 7: return "802.11n";
            case 8: return "802.11ac";
            case 10: return "802.11ax";
            case 11: return "802.11be";
            default: return "Unknown";
        }
    }

    private static string AuthAlgorithm(uint value)
    {
        switch (value) {
            case 1: return "Open";
            case 2: return "Shared Key";
            case 3: return "WPA Enterprise";
            case 4: return "WPA Personal";
            case 5: return "WPA None";
            case 6: return "WPA2 Enterprise";
            case 7: return "WPA2 Personal";
            case 8: return "WPA3 Enterprise";
            case 9: return "WPA3 Personal";
            case 10: return "OWE";
            case 11: return "WPA3 Enterprise 192";
            default: return "Unknown";
        }
    }

    private static string CipherAlgorithm(uint value)
    {
        switch (value) {
            case 0: return "None";
            case 1: return "WEP-40";
            case 2: return "TKIP";
            case 4: return "CCMP";
            case 5: return "WEP-104";
            case 6: return "BIP";
            case 8: return "GCMP";
            case 9: return "GCMP-256";
            case 10: return "CCMP-256";
            case 256: return "WEP";
            default: return "Unknown";
        }
    }
}
'@

    Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
}

function Get-WifiAnalysis {
    try {
        Write-AppTaskProgress 15 "正在初始化 WLAN 扫描"
        Initialize-WifiScannerType
        Write-AppTaskProgress 35 "正在扫描附近 Wi-Fi"
        $scan = [WinPsBoxWifiScanner]::Scan()
        foreach ($interfaceGroup in @($scan.Networks | Where-Object { $_.Connected } | Group-Object InterfaceId)) {
            $connectedEntries = @($interfaceGroup.Group | Sort-Object SignalQuality -Descending)
            for ($index = 1; $index -lt $connectedEntries.Count; $index++) { $connectedEntries[$index].Connected = $false }
        }
        $networks = @($scan.Networks | Sort-Object @{ Expression = "Connected"; Descending = $true }, @{ Expression = "SignalQuality"; Descending = $true }, Ssid)
        $networkData = @($networks | ForEach-Object {
            [PSCustomObject]@{
                interfaceId = [string]$_.InterfaceId
                interfaceName = [string]$_.InterfaceName
                ssid = [string]$_.Ssid
                bssid = [string]$_.Bssid
                signalQuality = [int]$_.SignalQuality
                rssi = [int]$_.Rssi
                frequencyMHz = [int]$_.FrequencyMHz
                channel = [int]$_.Channel
                band = [string]$_.Band
                radioType = [string]$_.RadioType
                authentication = [string]$_.Authentication
                cipher = [string]$_.Cipher
                profileName = [string]$_.ProfileName
                securityEnabled = [bool]$_.SecurityEnabled
                connected = [bool]$_.Connected
                connectable = [bool]$_.Connectable
            }
        })
        $channels = @(
            $networks |
                Where-Object { $_.Channel -gt 0 } |
                Group-Object Band, Channel |
                ForEach-Object {
                    $items = @($_.Group)
                    [PSCustomObject]@{
                        band = [string]$items[0].Band
                        channel = [int]$items[0].Channel
                        accessPoints = $items.Count
                        networks = @($items | ForEach-Object { $_.Ssid } | Sort-Object -Unique).Count
                        strongestSignal = [int](($items | Measure-Object SignalQuality -Maximum).Maximum)
                    }
                } |
                Sort-Object band, channel
        )
        Write-AppTaskProgress 85 "正在汇总信道占用"
        return @{
            success = $true
            interfaces = @($scan.Interfaces | ForEach-Object {
                [PSCustomObject]@{ id = [string]$_.Id; name = [string]$_.Name; state = [string]$_.State }
            })
            networks = $networkData
            channels = $channels
            scannedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        }
    }
    catch {
        return @{ success = $false; error = "Wi-Fi scan failed: $($_.Exception.Message)" }
    }
}

function ConvertTo-HttpHeaderMap($response) {
    $headers = [ordered]@{}
    foreach ($header in $response.Headers) {
        $headers[$header.Key] = (@($header.Value) -join ", ")
    }
    if ($response.Content) {
        foreach ($header in $response.Content.Headers) {
            $headers[$header.Key] = (@($header.Value) -join ", ")
        }
    }
    return $headers
}

function Invoke-HttpRedirectTrace([string]$url, [string]$method = "HEAD", [int]$maxRedirects = 10, [int]$timeoutMs = 10000) {
    $client = $null
    $handler = $null
    try {
        $targetUri = $null
        if (-not [Uri]::TryCreate($url, [UriKind]::Absolute, [ref]$targetUri) -or $targetUri.Scheme -notin @("http", "https")) {
            throw "Enter an absolute HTTP or HTTPS URL."
        }
        if ($targetUri.UserInfo) { throw "URLs containing embedded credentials are not supported." }
        $method = $method.ToUpperInvariant()
        if ($method -notin @("HEAD", "GET")) { throw "Only HEAD and GET requests are supported." }
        $maxRedirects = [math]::Min([math]::Max($maxRedirects, 1), 20)
        $timeoutMs = [math]::Min([math]::Max($timeoutMs, 1000), 30000)

        Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
        $handler = New-Object System.Net.Http.HttpClientHandler
        $handler.AllowAutoRedirect = $false
        $handler.UseCookies = $false
        $handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
        $client = New-Object System.Net.Http.HttpClient($handler)
        $client.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "WinPsBox/1.0 HTTP Redirect Trace") | Out-Null

        $visited = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
        $hops = New-Object System.Collections.Generic.List[object]
        $currentUri = $targetUri
        $currentMethod = $method
        $redirectStatusCodes = @(301, 302, 303, 307, 308)
        $loopDetected = $false
        $limitReached = $false
        $downgradeDetected = $false
        $completed = $false
        $totalWatch = [Diagnostics.Stopwatch]::StartNew()

        for ($hopIndex = 0; $hopIndex -le $maxRedirects; $hopIndex++) {
            Write-AppTaskProgress ([math]::Min(90, 12 + ($hopIndex * 7))) "正在请求第 $($hopIndex + 1) 跳" $currentUri.AbsoluteUri
            [void]$visited.Add($currentUri.AbsoluteUri)
            $request = New-Object System.Net.Http.HttpRequestMessage((New-Object System.Net.Http.HttpMethod($currentMethod)), $currentUri)
            $response = $null
            $cancellation = New-Object System.Threading.CancellationTokenSource
            $cancellation.CancelAfter($timeoutMs)
            $watch = [Diagnostics.Stopwatch]::StartNew()
            $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead, $cancellation.Token).GetAwaiter().GetResult()
            $watch.Stop()
            $headers = ConvertTo-HttpHeaderMap $response
            $statusCode = [int]$response.StatusCode
            $locationText = if ($response.Headers.Location) { [string]$response.Headers.Location.OriginalString } else { "" }
            $nextUri = $null
            $isRedirect = $redirectStatusCodes -contains $statusCode -and -not [string]::IsNullOrWhiteSpace($locationText)
            if ($isRedirect) {
                $nextUri = if ($response.Headers.Location.IsAbsoluteUri) { $response.Headers.Location } else { New-Object Uri($currentUri, $response.Headers.Location) }
            }
            $nextMethod = $currentMethod
            if ($isRedirect -and $statusCode -eq 303 -and $currentMethod -ne "HEAD") { $nextMethod = "GET" }
            $isDowngrade = $isRedirect -and $currentUri.Scheme -eq "https" -and $nextUri.Scheme -eq "http"
            if ($isDowngrade) { $downgradeDetected = $true }

            $hops.Add([PSCustomObject]@{
                index = $hopIndex + 1
                url = $currentUri.AbsoluteUri
                method = $currentMethod
                statusCode = $statusCode
                reasonPhrase = [string]$response.ReasonPhrase
                elapsedMs = [math]::Round($watch.Elapsed.TotalMilliseconds, 1)
                location = if ($nextUri) { $nextUri.AbsoluteUri } else { "" }
                nextMethod = $nextMethod
                hostChanged = if ($nextUri) { $currentUri.Host -ne $nextUri.Host } else { $false }
                schemeDowngrade = $isDowngrade
                contentLength = if ($response.Content.Headers.ContentLength) { [long]$response.Content.Headers.ContentLength } else { $null }
                contentType = if ($response.Content.Headers.ContentType) { [string]$response.Content.Headers.ContentType } else { "" }
                server = if ($headers.Contains("Server")) { [string]$headers["Server"] } else { "" }
                headers = $headers
            })

            $shouldStop = $false
            if (-not $isRedirect) {
                $completed = $true
                $shouldStop = $true
            }
            elseif ($visited.Contains($nextUri.AbsoluteUri)) {
                $loopDetected = $true
                $shouldStop = $true
            }
            elseif ($hopIndex -ge $maxRedirects) {
                $limitReached = $true
                $shouldStop = $true
            }
            else {
                $currentUri = $nextUri
                $currentMethod = $nextMethod
            }

            if ($response) { $response.Dispose() }
            $request.Dispose()
            $cancellation.Dispose()
            if ($shouldStop) { break }
        }

        $totalWatch.Stop()
        $lastHop = if ($hops.Count) { $hops[$hops.Count - 1] } else { $null }
        $hopArray = $hops.ToArray()
        return @{
            success = $true
            inputUrl = $targetUri.AbsoluteUri
            finalUrl = if ($lastHop -and -not $lastHop.location) { $lastHop.url } elseif ($lastHop) { $lastHop.location } else { $targetUri.AbsoluteUri }
            hops = $hopArray
            redirectCount = @($hopArray | Where-Object { $_.location }).Count
            totalElapsedMs = [math]::Round($totalWatch.Elapsed.TotalMilliseconds, 1)
            completed = $completed
            loopDetected = $loopDetected
            limitReached = $limitReached
            downgradeDetected = $downgradeDetected
            tracedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        }
    }
    catch {
        return @{ success = $false; error = "HTTP redirect trace failed: $($_.Exception.Message)" }
    }
    finally {
        if ($client) { $client.Dispose() }
        if ($handler) { $handler.Dispose() }
    }
}
