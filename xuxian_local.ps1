# Xuxian 1.6 local project library / file bridge (Windows PowerShell 5.1+). MIT License.
# Loopback-only; no web dependencies; no privileged access; no arbitrary user-supplied paths.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:Token = [guid]::NewGuid().ToString('N')
$script:Bindings = @{}
$script:Stopping = $false
$script:Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$script:Listener.Start()
$script:Port = $script:Listener.LocalEndpoint.Port
$script:Origin = "http://127.0.0.1:$($script:Port)"
$script:ProjectDir = Join-Path $PSScriptRoot '剧本项目'
if (-not [IO.Directory]::Exists($script:ProjectDir)) { [IO.Directory]::CreateDirectory($script:ProjectDir) | Out-Null }
$sourceHtml = Join-Path $PSScriptRoot '叙线.html'
if (-not [IO.File]::Exists($sourceHtml)) { throw "找不到 $sourceHtml" }
$script:Html = [IO.File]::ReadAllText($sourceHtml, [Text.Encoding]::UTF8)
$script:Html = $script:Html.Replace("connect-src 'none'", "connect-src 'self'")
$script:Html = $script:Html.Replace('</head>', "<script>window.__XUXIAN_BRIDGE_TOKEN__='$($script:Token)';</script>`n</head>")

function To-Json($obj) { ConvertTo-Json -InputObject $obj -Compress -Depth 65 }
function File-Stamp($path) {
    $f = Get-Item -LiteralPath $path -ErrorAction Stop
    $ms = [long][math]::Floor(($f.LastWriteTimeUtc.Ticks - 621355968000000000) / 10000)
    return @{ size = [long]$f.Length; lastModified = $ms }
}
function Write-Reply($stream, $status, $content, $mime = 'application/json; charset=utf-8') {
    $reasons = @{ 200='OK'; 400='Bad Request'; 403='Forbidden'; 404='Not Found'; 405='Method Not Allowed'; 409='Conflict'; 413='Payload Too Large'; 500='Internal Server Error' }
    $message = if ($reasons.ContainsKey([int]$status)) { $reasons[[int]$status] } else { 'Error' }
    $payload = [Text.Encoding]::UTF8.GetBytes([string]$content)
    $header = "HTTP/1.1 $status $message`r`nContent-Type: $mime`r`nContent-Length: $($payload.Length)`r`nCache-Control: no-store, no-cache`r`nReferrer-Policy: no-referrer`r`nX-Content-Type-Options: nosniff`r`nConnection: close`r`n`r`n"
    $headBytes = [Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($headBytes, 0, $headBytes.Length)
    $stream.Write($payload, 0, $payload.Length)
    $stream.Flush()
}
function Json-Reply($stream, $status, $obj) { Write-Reply $stream $status (To-Json $obj) }
function Read-Request($stream) {
    $header = New-Object System.IO.MemoryStream
    while ($true) {
        $b = $stream.ReadByte()
        if ($b -lt 0) { throw '连接提前断开' }
        $header.WriteByte([byte]$b)
        $n = [int]$header.Length
        if ($n -gt 16384) { throw 'HTTP 头过长' }
        if ($n -ge 4) {
            $raw = $header.GetBuffer()
            if ($raw[$n - 4] -eq 13 -and $raw[$n - 3] -eq 10 -and $raw[$n - 2] -eq 13 -and $raw[$n - 1] -eq 10) { break }
        }
    }
    $rawHeader = [Text.Encoding]::ASCII.GetString($header.ToArray())
    $parts = $rawHeader -split "`r`n"
    $first = $parts[0] -split ' '
    if ($first.Count -lt 2) { throw '无效的 HTTP 请求' }
    $headers = @{}
    foreach ($line in $parts | Select-Object -Skip 1) {
        $split = $line.IndexOf(':')
        if ($split -gt 0) { $headers[$line.Substring(0, $split).Trim().ToLowerInvariant()] = $line.Substring($split+1).Trim() }
    }
    $length = 0
    if ($headers.ContainsKey('content-length')) { $length = [int]$headers['content-length'] }
    if ($length -lt 0 -or $length -gt (28 * 1024 * 1024)) { throw '请求内容过大' }
    $data = New-Object byte[] $length
    $pos = 0
    while ($pos -lt $length) {
        $count = $stream.Read($data, $pos, $length - $pos)
        if ($count -le 0) { throw '请求未传完' }
        $pos += $count
    }
    return @{ Method=$first[0]; Path=$first[1]; Headers=$headers; Text=[Text.Encoding]::UTF8.GetString($data) }
}
function File-Dialog($save, $suggested = '') {
    if ($save) {
        $dlg = New-Object System.Windows.Forms.SaveFileDialog
        $dlg.OverwritePrompt = $true
        $dlg.AddExtension = $true
        $dlg.DefaultExt = 'json'
        if ($suggested) { $dlg.FileName = $suggested }
    } else {
        $dlg = New-Object System.Windows.Forms.OpenFileDialog
        $dlg.CheckFileExists = $true
    }
    $dlg.Filter = 'JSON (*.json)|*.json|All files (*.*)|*.*'
    $dlg.RestoreDirectory = $true
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $owner.ShowInTaskbar = $false
    $owner.Width = 1; $owner.Height = 1
    $owner.Opacity = 0
    try {
        $owner.Show()
        $result = $dlg.ShowDialog($owner)
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) { return $dlg.FileName }
        return $null
    } finally { $owner.Close(); $owner.Dispose(); $dlg.Dispose() }
}
function Write-Atomically($path, $content) {
    $folder = [IO.Path]::GetDirectoryName($path)
    $temp = [IO.Path]::Combine($folder, '.xuxian-' + [guid]::NewGuid().ToString('N') + '.tmp')
    try {
        [IO.File]::WriteAllText($temp, $content, ([Text.UTF8Encoding]::new($false)))
        if ([IO.File]::Exists($path)) {
            try { [IO.File]::Replace($temp, $path, $null) }
            catch { [IO.File]::Copy($temp, $path, $true) }
        } else {
            [IO.File]::Move($temp, $path)
        }
    } finally { if ([IO.File]::Exists($temp)) { [IO.File]::Delete($temp) } }
}
# Project files are restricted to the configured sibling folder. No absolute path is accepted from HTTP.
function Project-Path($filename) {
    $n = [string]$filename
    if (-not $n -or $n.Length -gt 220 -or $n -ne [IO.Path]::GetFileName($n) -or
        $n -match '[\\/:*?"<>|]' -or $n.StartsWith('.') -or -not $n.ToLowerInvariant().EndsWith('.json')) {
        throw '项目文件名无效'
    }
    return [IO.Path]::Combine($script:ProjectDir, $n)
}
function Project-Name($title) {
    $n = ([string]$title -replace '[\\/:*?"<>|\x00-\x1f]', '_').Trim().TrimEnd('.')
    if (-not $n) { $n = '未命名剧本' }
    if ($n.Length -gt 90) { $n = $n.Substring(0,90) }
    return $n
}
function Unique-ProjectPath($title) {
    $base = Project-Name $title
    $candidate = [IO.Path]::Combine($script:ProjectDir, $base + '.story.json')
    for ($n=2; [IO.File]::Exists($candidate); $n++) {
        if ($n -gt 9999) { throw '重名文件过多' }
        $candidate = [IO.Path]::Combine($script:ProjectDir, $base + ' (' + $n + ').story.json')
    }
    return $candidate
}
function Validate-Story($txt) {
    if ([Text.Encoding]::UTF8.GetByteCount([string]$txt) -gt 25 * 1024 * 1024) { throw '剧本超过 25 MB' }
    $obj = ConvertFrom-Json -InputObject ([string]$txt) -ErrorAction Stop
    if ($obj.format -ne 'xuxian.story' -or ($obj.version -ne 1 -and $obj.version -ne 2 -and $obj.version -ne 3) -or -not $obj.id -or -not $obj.routes -or -not $obj.chapters) {
        throw '不是有效的叙线剧本文件'
    }
    return $obj
}
function Return-Project($stream,$path) {
    if (-not [IO.File]::Exists($path)) { Json-Reply $stream 404 @{error='该项目文件不存在，刷新列表重试'}; return }
    $stamp=File-Stamp $path
    if ($stamp.size -gt 25 * 1024 * 1024) { Json-Reply $stream 413 @{error='文件超过 25 MB'}; return }
    $txt = [IO.File]::ReadAllText($path,[Text.Encoding]::UTF8)
    $p = Validate-Story $txt
    $id = [guid]::NewGuid().ToString('N')
    $script:Bindings[$id] = @{Path=$path; ProjectId=[string]$p.id}
    Json-Reply $stream 200 @{name=[IO.Path]::GetFileName($path); text=$txt; stamp=$stamp; bindingId=$id}
}
function Handle-Projects($request,$body,$stream) {
    switch ($request.Path) {
      '/api/projects/list' {
        $items = @()
        $files = @(Get-ChildItem -LiteralPath $script:ProjectDir -File -ErrorAction Stop | Where-Object { $_.Name.ToLowerInvariant().EndsWith('.json') } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 500)
        foreach ($file in $files) {
          if ($file.Length -gt 25*1024*1024) { continue }
          try {
            $txt = [IO.File]::ReadAllText($file.FullName,[Text.Encoding]::UTF8)
            $p = Validate-Story $txt
            $items += @{fileName=$file.Name; title=[string]$p.title; id=[string]$p.id; modified=(File-Stamp $file.FullName).lastModified; routes=@($p.routes).Count; chapters=@($p.chapters).Count; characters=@($p.characters).Count}
          } catch { continue }
        }
        Json-Reply $stream 200 @{items=@($items); directory='剧本项目'}
        return
      }
      '/api/projects/open' {
        $path=Project-Path $body.fileName
        Return-Project $stream $path
        return
      }
      '/api/projects/create' {
        $p=Validate-Story $body.text
        $title=[string]$p.title
        if (-not $title.Trim()) { throw '项目名称不能为空' }
        # Existing IDs are only compared inside the managed directory; do not silently associate a different file with the same ID.
        $target = Unique-ProjectPath $title
        Write-Atomically $target ([string]$body.text)
        Return-Project $stream $target
        return
      }
      '/api/projects/duplicate' {
        $path=Project-Path $body.fileName
        if (-not [IO.File]::Exists($path)) { Json-Reply $stream 404 @{error='项目不存在'}; return }
        $p=Validate-Story ([IO.File]::ReadAllText($path,[Text.Encoding]::UTF8))
        $p.id='project_'+[guid]::NewGuid().ToString('N')
        $p.title=([string]$p.title)+' 副本'
        $p.createdAt=[DateTime]::UtcNow.ToString('o')
        $p.updatedAt=$p.createdAt
        $target=Unique-ProjectPath $p.title
        Write-Atomically $target (ConvertTo-Json -InputObject $p -Depth 65)
        Return-Project $stream $target
        return
      }
      '/api/projects/rename' {
        $path=Project-Path $body.fileName
        if (-not [IO.File]::Exists($path)) { Json-Reply $stream 404 @{error='项目不存在'}; return }
        $title=([string]$body.title).Trim()
        if (-not $title -or $title.Length -gt 200) { throw '项目名称应为 1—200 个字符' }
        $p=Validate-Story ([IO.File]::ReadAllText($path,[Text.Encoding]::UTF8))
        $p.title=$title
        $p.updatedAt=[DateTime]::UtcNow.ToString('o')
        $target = Unique-ProjectPath $title
        Write-Atomically $target (ConvertTo-Json -InputObject $p -Depth 65)
        [IO.File]::Delete($path)
        Return-Project $stream $target
        return
      }
      '/api/projects/delete' {
        $path=Project-Path $body.fileName
        if (-not [IO.File]::Exists($path)) { Json-Reply $stream 404 @{error='项目不存在'}; return }
        $trash=Join-Path $script:ProjectDir '_回收站'
        if (-not [IO.Directory]::Exists($trash)) { [IO.Directory]::CreateDirectory($trash) | Out-Null }
        $archive=[IO.Path]::Combine($trash,([IO.Path]::GetFileNameWithoutExtension($path) + '_' + (Get-Date -Format 'yyyyMMdd_HHmmss') + '_' + [guid]::NewGuid().ToString('N').Substring(0,6) + '.json'))
        [IO.File]::Move($path,$archive)
        Json-Reply $stream 200 @{deleted=$true}
        return
      }
      '/api/projects/open-folder' {
        Start-Process -FilePath 'explorer.exe' -ArgumentList ('"'+$script:ProjectDir+'"') | Out-Null
        Json-Reply $stream 200 @{opened=$true}
        return
      }
    }
    Json-Reply $stream 404 @{error='未知项目操作'}
}

function Handle-API($request, $stream) {
    if ($request.Path -eq '/api/shutdown') {
        Json-Reply $stream 200 @{stopped=$true}
        $script:Stopping = $true
        return
    }
    $body = if ($request.Text) { ConvertFrom-Json -InputObject $request.Text -ErrorAction Stop } else { $null }
    if ($request.Path.StartsWith('/api/projects/')) { Handle-Projects $request $body $stream; return }
    if ($request.Path -eq '/api/open') {
        $path = File-Dialog $false
        if (-not $path) { Json-Reply $stream 200 @{cancelled=$true}; return }
        $stamp = File-Stamp $path
        if ($stamp.size -gt 25 * 1024 * 1024) { Json-Reply $stream 413 @{error='文件超过 25 MB'}; return }
        $txt = [IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
        try { $p = ConvertFrom-Json -InputObject $txt -ErrorAction Stop }
        catch { Json-Reply $stream 400 @{error='所选 JSON 格式错误'}; return }
        if ($p.format -ne 'xuxian.story' -or (-not $p.id)) { Json-Reply $stream 400 @{error='不是叙线剧本文件'}; return }
        $id = [guid]::NewGuid().ToString('N')
        $script:Bindings[$id] = @{Path=$path; ProjectId=[string]$p.id}
        Json-Reply $stream 200 @{name=[IO.Path]::GetFileName($path); text=$txt; stamp=$stamp; bindingId=$id}; return
    }
    if ($request.Path -ne '/api/save' -and $request.Path -ne '/api/save-as') { Json-Reply $stream 404 @{error='未知的本地操作'}; return }
    if (-not $body -or $null -eq $body.text) { Json-Reply $stream 400 @{error='缺少剧本内容'}; return }
    $txt = [string]$body.text
    if ([Text.Encoding]::UTF8.GetByteCount($txt) -gt 25*1024*1024) { Json-Reply $stream 413 @{error='剧本超过大小限制'}; return }
    try { $p = ConvertFrom-Json -InputObject $txt -ErrorAction Stop }
    catch { Json-Reply $stream 400 @{error='剧本 JSON 无效'}; return }
    if ($p.format -ne 'xuxian.story' -or ($p.version -ne 1 -and $p.version -ne 2 -and $p.version -ne 3) -or (-not $p.id)) { Json-Reply $stream 400 @{error='剧本格式或版本不正确'}; return }
    if ($request.Path -eq '/api/save-as') {
        $suggested = ([string]$p.title -replace '[\\/:*?"<>|]', '_') + '.story.json'
        $path = File-Dialog $true $suggested
        if (-not $path) { Json-Reply $stream 200 @{cancelled=$true}; return }
        Write-Atomically $path $txt
        $id = [guid]::NewGuid().ToString('N')
        $script:Bindings[$id] = @{Path=$path; ProjectId=[string]$p.id}
        Json-Reply $stream 200 @{name=[IO.Path]::GetFileName($path); stamp=(File-Stamp $path); bindingId=$id}; return
    }
    $id = [string]$body.bindingId
    $binding = $script:Bindings[$id]
    if (-not $binding -or $binding.ProjectId -ne [string]$p.id) { Json-Reply $stream 409 @{error='源文件关联已改变，请重新打开原 JSON'}; return }
    $path = [string]$binding.Path
    if (-not [IO.File]::Exists($path)) { Json-Reply $stream 409 @{error='磁盘上的源文件不存在，请另存或重新打开'}; return }
    $actual = File-Stamp $path
    if (-not $body.force) {
        $expected = $body.stamp
        if (-not $expected -or $actual.size -ne [long]$expected.size -or $actual.lastModified -ne [long]$expected.lastModified) {
            Json-Reply $stream 409 @{error='源文件已在外部修改'}; return
        }
    }
    Write-Atomically $path $txt
    Json-Reply $stream 200 @{name=[IO.Path]::GetFileName($path); stamp=(File-Stamp $path); bindingId=$id}
}

Write-Host ''
Write-Host '叙线本地版已启动：只在本机提供文件读写服务。' -ForegroundColor Cyan
Write-Host '可以从编辑器右上角更多菜单停止本地服务。'
Write-Host $script:Origin
try {
    Start-Process ($script:Origin + '/')
    while (-not $script:Stopping) {
        $client = $script:Listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 5000
            $client.SendTimeout = 10000
            $stream = $client.GetStream()
            $request = Read-Request $stream
            if ($request.Headers['host'] -ne "127.0.0.1:$($script:Port)") { Json-Reply $stream 403 @{error='无效请求来源'}; continue }
            if ($request.Method -eq 'GET' -and ($request.Path -eq '/' -or $request.Path -eq '/index.html')) {
                Write-Reply $stream 200 $script:Html 'text/html; charset=utf-8'; continue
            }
            if ($request.Method -ne 'POST' -or -not $request.Path.StartsWith('/api/')) { Json-Reply $stream 404 @{error='路径不存在'}; continue }
            if ($request.Headers['x-xuxian-token'] -ne $script:Token) { Json-Reply $stream 403 @{error='没有文件写入授权'}; continue }
            if ($request.Headers.ContainsKey('origin') -and $request.Headers['origin'] -ne $script:Origin) { Json-Reply $stream 403 @{error='不接受跨站请求'}; continue }
            Handle-API $request $stream
        } catch {
            try { Json-Reply $stream 500 @{error=$_.Exception.Message} } catch { }
        } finally { $client.Close() }
    }
} finally { $script:Listener.Stop() }
