function RemoveLineRanges {
    param([string]$Path, [int[]]$Starts, [int[]]$Ends)
    $lines = [System.IO.File]::ReadAllLines($Path)
    $pairs = @()
    for ($i = 0; $i -lt $Starts.Count; $i++) { $pairs += ,@($Starts[$i], $Ends[$i]) }
    $pairs = $pairs | Sort-Object { $_[0] } -Descending
    $remove = New-Object System.Collections.Generic.HashSet[int]
    foreach ($p in $pairs) { for ($i = $p[0]; $i -le $p[1]; $i++) { [void]$remove.Add($i) } }
    $kept = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $lines.Count; $i++) { if (-not $remove.Contains($i)) { [void]$kept.Add($lines[$i]) } }
    [System.IO.File]::WriteAllLines($Path, $kept.ToArray())
    Write-Output ("{0}: removidas {1} linhas (ranges: {2})" -f $Path, $remove.Count, (($pairs | Sort-Object { $_[0] }) | ForEach-Object { "[$($_[0])..$($_[1])]" }) -join ", ")
}

function FindIndex {
    param([string[]]$Lines, [string]$StartsWithTrimmed, [string]$NextContains)
    for ($i = 0; $i -lt $Lines.Count - 1; $i++) {
        $t = $Lines[$i].Trim()
        if ($t -eq $StartsWithTrimmed -and $Lines[$i + 1].Contains($NextContains)) { return $i }
    }
    return -1
}

function FindLineIndex {
    param([string[]]$Lines, [string]$Contains)
    for ($i = 0; $i -lt $Lines.Count; $i++) { if ($Lines[$i].Contains($Contains)) { return $i } }
    return -1
}

$htmlFiles = @(
    'C:\Users\cannabisuser\Downloads\agrvai\index.html',
    'C:\Users\cannabisuser\Downloads\agrvai\icon.html'
)

foreach ($path in $htmlFiles) {
    $lines = [System.IO.File]::ReadAllLines($path)
    $ranges = @()

    # ViewContent: if (typeof fbq !== 'undefined') { ... fbq('track', 'ViewContent' ... ) 9 linhas
    $vi = FindIndex $lines "if (typeof fbq !== 'undefined') {" "fbq('track', 'ViewContent'"
    if ($vi -ge 0) { $ranges += ,@($vi, $vi + 8) }

    # AddToCart: comentario + bloco if (10 linhas)
    $ai = FindLineIndex $lines "// Enviar evento AddToCart para Facebook Pixel"
    if ($ai -ge 0) { $ranges += ,@($ai, $ai + 9) }

    if ($ranges.Count -gt 0) {
        RemoveLineRanges $path ($ranges | ForEach-Object { $_[0] }) ($ranges | ForEach-Object { $_[1] })
    } else {
        Write-Output ("{0}: nenhum bloco ViewContent/AddToCart encontrado" -f $path)
    }
}

# delivry.js: blocos if (pixel != "") { fbq('track', 'AddToCart') } e Purchase
$d = 'C:\Users\cannabisuser\Downloads\agrvai\js\delivry.js'
$lines = [System.IO.File]::ReadAllLines($d)
$ranges = @()

for ($i = 0; $i -lt $lines.Count - 1; $i++) {
    if ($lines[$i].Trim() -eq 'if (pixel != "") {' -and $lines[$i + 1].Contains("fbq('track', 'AddToCart')")) {
        $ranges += ,@($i, $i + 2)
    }
    if ($lines[$i].Trim() -eq 'if (pixel != "") {' -and $lines[$i + 1].Contains("fbq('track', 'Purchase'")) {
        $ranges += ,@($i, $i + 2)
    }
}

if ($ranges.Count -gt 0) {
    RemoveLineRanges $d ($ranges | ForEach-Object { $_[0] }) ($ranges | ForEach-Object { $_[1] })
} else {
    Write-Output ("{0}: nenhum bloco fbq encontrado" -f $d)
}
