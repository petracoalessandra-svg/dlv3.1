$files = @(
    'C:\Users\cannabisuser\Downloads\agrvai\index.html',
    'C:\Users\cannabisuser\Downloads\agrvai\icon.html'
)

foreach ($path in $files) {
    $s = [System.IO.File]::ReadAllText($path)
    $orig = $s

    # Remove bloco Facebook Pixel (Meta Ads)
    $s = $s -replace '(?s)<!--\s*Facebook Pixel Code\s*-->.*?<!--\s*End Facebook Pixel Code\s*-->', ''

    # Remove tag fbevents.js apenas no index.html
    if ($path -like '*index.html') {
        $s = $s -replace '<script\s+async=""\s+src="js/fbevents\.js"></script>\r?\n?', ''
    }

    [System.IO.File]::WriteAllText($path, $s)
    Write-Output ("{0}: mudado={1}" -f $path, ($s -ne $orig))
}
