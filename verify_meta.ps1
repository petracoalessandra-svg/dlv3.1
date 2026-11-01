$paths = @(
    'C:\Users\cannabisuser\Downloads\agrvai\index.html',
    'C:\Users\cannabisuser\Downloads\agrvai\icon.html',
    'C:\Users\cannabisuser\Downloads\agrvai\all.js',
    'C:\Users\cannabisuser\Downloads\agrvai\delivry.js'
)

Write-Output "=== Busca de rastros do Meta/Facebook Pixel ==="
$found = $false
foreach ($p in $paths) {
    $matches = Select-String -Pattern 'fbq|fbevents|connect\.facebook\.net|Facebook Pixel' -Path $p
    if ($matches) {
        $found = $true
        foreach ($m in $matches) {
            Write-Output ("{0} linha {1}: {2}" -f $m.Path, $m.LineNumber, $m.Line)
        }
    }
}
if (-not $found) { Write-Output "Nenhum rastro do Meta/Facebook Pixel encontrado." }

Write-Output ""
Write-Output "=== Referências a fbevents.js / pixel-dominio.js nos HTML ==="
$htmlMatches = Select-String -Pattern 'fbevents\.js|pixel-dominio\.js' -Path 'C:\Users\cannabisuser\Downloads\agrvai\*.html'
if ($htmlMatches) {
    foreach ($m in $htmlMatches) { Write-Output ("{0} linha {1}: {2}" -f $m.Path, $m.LineNumber, $m.Line) }
} else {
    Write-output "Nenhuma referência a fbevents.js ou pixel-dominio.js nos HTML."
}
