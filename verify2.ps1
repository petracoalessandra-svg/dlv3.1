$paths = @(
    'C:\Users\cannabisuser\Downloads\agrvai\index.html',
    'C:\Users\cannabisuser\Downloads\agrvai\icon.html',
    'C:\Users\cannabisuser\Downloads\agrvai\js\delivry.js'
)
$found = $false
foreach ($p in $paths) {
    $matches = Select-String -Pattern 'fbq' -Path $p
    if ($matches) {
        $found = $true
        Write-Output ("=== {0} ===" -f $p)
        foreach ($m in $matches) {
            Write-Output ("linha {0}: {1}" -f $m.LineNumber, $m.Line)
        }
    }
}
if (-not $found) { Write-Output "Nenhuma referencia a fbq restante." }
