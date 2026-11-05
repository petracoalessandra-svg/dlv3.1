function Show($path, $from, $to) {
    Write-Output ("===== {0} linhas {1}-{2} =====" -f $path, $from, $to)
    $lines = [System.IO.File]::ReadAllLines($path)
    for ($i = $from - 1; $i -lt $to; $i++) {
        $vis = $lines[$i] -replace '\t', '[TAB]' -replace ' ', '.'
        Write-Output ("{0}: [{1}]" -f ($i + 1), $vis)
    }
}

Show 'C:\Users\cannabisuser\Downloads\agrvai\index.html' 9951 9963
Show 'C:\Users\cannabisuser\Downloads\agrvai\index.html' 10989 11003
Show 'C:\Users\cannabisuser\Downloads\agrvai\js\delivry.js' 238 242
Show 'C:\Users\cannabisuser\Downloads\agrvai\js\delivry.js' 564 568
