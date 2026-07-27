param(
  [string]$BuildDirectory = (Join-Path $PSScriptRoot '..\build'),
  [string]$PublicDirectory = (Join-Path $PSScriptRoot '..\public')
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$coral = [System.Drawing.ColorTranslator]::FromHtml('#EF6548')
$ink = [System.Drawing.ColorTranslator]::FromHtml('#181510')
$dark = [System.Drawing.ColorTranslator]::FromHtml('#101311')
$muted = [System.Drawing.ColorTranslator]::FromHtml('#9AA39D')
$light = [System.Drawing.ColorTranslator]::FromHtml('#F4F6F5')

function New-Canvas([int]$width, [int]$height, [System.Drawing.Color]$background, [bool]$transparent = $false) {
  $format = if ($transparent) { [System.Drawing.Imaging.PixelFormat]::Format32bppArgb } else { [System.Drawing.Imaging.PixelFormat]::Format24bppRgb }
  $bitmap = [System.Drawing.Bitmap]::new($width, $height, $format)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  if ($transparent) { $graphics.Clear([System.Drawing.Color]::Transparent) } else { $graphics.Clear($background) }
  return @{ Bitmap = $bitmap; Graphics = $graphics }
}

function New-RoundedPath([System.Drawing.RectangleF]$bounds, [float]$radius) {
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $radius * 2
  $path.AddArc($bounds.X, $bounds.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($bounds.Right - $diameter, $bounds.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($bounds.Right - $diameter, $bounds.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($bounds.X, $bounds.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Draw-Mark([System.Drawing.Graphics]$graphics, [System.Drawing.RectangleF]$bounds) {
  $path = New-RoundedPath $bounds ($bounds.Width * 0.18)
  $brush = [System.Drawing.SolidBrush]::new($coral)
  $graphics.FillPath($brush, $path)
  $brush.Dispose()
  $path.Dispose()

  $barBrush = [System.Drawing.SolidBrush]::new($ink)
  $barWidth = $bounds.Width * 0.13
  $gap = $bounds.Width * 0.08
  $startX = $bounds.X + ($bounds.Width * 0.235)
  $bottom = $bounds.Bottom - ($bounds.Height * 0.20)
  $heights = @(($bounds.Height * 0.31), ($bounds.Height * 0.55), ($bounds.Height * 0.42))
  for ($index = 0; $index -lt 3; $index++) {
    $rectangle = [System.Drawing.RectangleF]::new($startX + (($barWidth + $gap) * $index), $bottom - $heights[$index], $barWidth, $heights[$index])
    $graphics.FillRectangle($barBrush, $rectangle)
  }
  $barBrush.Dispose()
}

New-Item -ItemType Directory -Force -Path $BuildDirectory, $PublicDirectory | Out-Null

$icon = New-Canvas 512 512 $dark $true
Draw-Mark $icon.Graphics ([System.Drawing.RectangleF]::new(48, 48, 416, 416))
$icon.Bitmap.Save((Join-Path $BuildDirectory 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$icon.Bitmap.Save((Join-Path $PublicDirectory 'caballocci-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$icon.Graphics.Dispose()
$icon.Bitmap.Dispose()

$sidebar = New-Canvas 164 314 $dark
Draw-Mark $sidebar.Graphics ([System.Drawing.RectangleF]::new(24, 28, 68, 68))
$titleFont = [System.Drawing.Font]::new('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
$copyFont = [System.Drawing.Font]::new('Segoe UI', 8.5, [System.Drawing.FontStyle]::Regular)
$lightBrush = [System.Drawing.SolidBrush]::new($light)
$mutedBrush = [System.Drawing.SolidBrush]::new($muted)
$sidebar.Graphics.DrawString('caballocci', $titleFont, $lightBrush, 22, 118)
$sidebarCopy = 'Planifica. Crea.' + [Environment]::NewLine + 'Publica a tu ritmo.'
$sidebar.Graphics.DrawString($sidebarCopy, $copyFont, $mutedBrush, 22, 154)
$sidebar.Bitmap.Save((Join-Path $BuildDirectory 'installerSidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$sidebar.Bitmap.Save((Join-Path $BuildDirectory 'uninstallerSidebar.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$sidebar.Graphics.Dispose()
$sidebar.Bitmap.Dispose()

$header = New-Canvas 150 57 $light
$headerTitleFont = [System.Drawing.Font]::new('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$inkBrush = [System.Drawing.SolidBrush]::new($ink)
$header.Graphics.DrawString('caballocci', $headerTitleFont, $inkBrush, 8, 18)
Draw-Mark $header.Graphics ([System.Drawing.RectangleF]::new(104, 8, 40, 40))
$header.Bitmap.Save((Join-Path $BuildDirectory 'installerHeader.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
$header.Graphics.Dispose()
$header.Bitmap.Dispose()

$titleFont.Dispose()
$copyFont.Dispose()
$headerTitleFont.Dispose()
$lightBrush.Dispose()
$mutedBrush.Dispose()
$inkBrush.Dispose()

Write-Output "Brand assets generated in $BuildDirectory and $PublicDirectory"
