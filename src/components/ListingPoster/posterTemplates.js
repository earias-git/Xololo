// XOLOLO Promote v1 — Sub-commit 4: Templates de poster.
//
// Cada template es una función `draw(ctx, opts)` que dibuja el poster
// en un <canvas> HTML. Dimensiones base: 850×1100 (carta a ~100dpi).
// Para impresión real jspdf lo escala al tamaño del PDF.
//
// Slots editables (opts):
//   title       — del listing (editable)
//   price       — formateado MXN (editable)
//   cta         — texto del call-to-action (editable)
//   color       — color primario (editable, hex)
//   productImg  — HTMLImageElement ya cargada (o null si falló)
//   qrImg       — HTMLImageElement del QR (ya cargada)
//
// Convenciones:
//   - Fondo blanco por default; cada template usa `color` como acento.
//   - Si falta productImg, se dibuja un placeholder gris con 📦.
//   - Si falta qrImg, se omite el QR (no bloqueante).

const POSTER_W = 850;
const POSTER_H = 1100;

// Helpers de layout.
const wrapText = (ctx, text, x, y, maxWidth, lineHeight, maxLines) => {
  const words = String(text || '').split(' ');
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const used = lines.slice(0, maxLines);
  if (lines.length > maxLines && used.length > 0) {
    const last = used[used.length - 1];
    let truncated = last;
    while (ctx.measureText(truncated + '…').width > maxWidth && truncated.length > 0) {
      truncated = truncated.slice(0, -1);
    }
    used[used.length - 1] = truncated + '…';
  }
  used.forEach((l, idx) => {
    ctx.fillText(l, x, y + idx * lineHeight);
  });
  return used.length * lineHeight;
};

const drawProductImageOrPlaceholder = (ctx, img, x, y, w, h, radius = 16) => {
  // Fondo (en caso de fallar la imagen).
  ctx.save();
  ctx.fillStyle = '#f2f2f2';
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();
  if (img && img.complete && img.naturalWidth > 0) {
    // Dibujar imagen con "cover" dentro del rect redondeado.
    ctx.save();
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
    const srcRatio = img.naturalWidth / img.naturalHeight;
    const dstRatio = w / h;
    let sx = 0,
      sy = 0,
      sw = img.naturalWidth,
      sh = img.naturalHeight;
    if (srcRatio > dstRatio) {
      // más ancha → recortar lados
      sw = img.naturalHeight * dstRatio;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / dstRatio;
      sy = (img.naturalHeight - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    ctx.restore();
  } else {
    ctx.fillStyle = '#bbbbbb';
    ctx.font = 'bold 120px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📦', x + w / 2, y + h / 2);
  }
  ctx.restore();
};

const roundRect = (ctx, x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
};

// ---------- Template "Fresco" ----------
// Banda de color arriba, imagen centrada, precio grande, QR abajo derecha.
const drawFresco = (ctx, opts) => {
  const { title, price, cta, color, productImg, qrImg } = opts;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);

  // Banda superior con color
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, POSTER_W, 180);

  // Logo/marca pequeño
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('XOLOLO', 60, 60);

  // Título (sobre la banda)
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px sans-serif';
  ctx.textBaseline = 'top';
  wrapText(ctx, title, 60, 100, POSTER_W - 120, 60, 1);

  // Imagen del producto, centrada
  drawProductImageOrPlaceholder(ctx, productImg, 100, 230, POSTER_W - 200, 500, 24);

  // Precio
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 92px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(price, POSTER_W / 2, 770);

  // CTA
  ctx.fillStyle = '#555555';
  ctx.font = '26px sans-serif';
  ctx.fillText(cta, POSTER_W / 2, 890);

  // QR abajo derecha
  if (qrImg && qrImg.complete) {
    const qrSize = 180;
    const qx = POSTER_W - qrSize - 60;
    const qy = POSTER_H - qrSize - 60;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(qx - 8, qy - 8, qrSize + 16, qrSize + 16);
    ctx.drawImage(qrImg, qx, qy, qrSize, qrSize);
  }
};

// ---------- Template "Elegante" ----------
// Marco de color, tipografía serif, precio con línea decorativa.
const drawElegante = (ctx, opts) => {
  const { title, price, cta, color, productImg, qrImg } = opts;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);

  // Marco de color
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.strokeRect(40, 40, POSTER_W - 80, POSTER_H - 80);

  // Marca
  ctx.fillStyle = color;
  ctx.font = 'bold 22px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('— XOLOLO —', POSTER_W / 2, 90);

  // Imagen cuadrada arriba
  drawProductImageOrPlaceholder(ctx, productImg, 130, 150, POSTER_W - 260, POSTER_W - 260, 12);

  // Título
  ctx.fillStyle = '#222222';
  ctx.font = 'bold 44px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const titleY = 150 + (POSTER_W - 260) + 40;
  wrapText(ctx, title, 80, titleY, POSTER_W - 160, 54, 2);

  // Línea decorativa
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(POSTER_W / 2 - 60, titleY + 130);
  ctx.lineTo(POSTER_W / 2 + 60, titleY + 130);
  ctx.stroke();

  // Precio
  ctx.fillStyle = color;
  ctx.font = 'bold 72px serif';
  ctx.fillText(price, POSTER_W / 2, titleY + 150);

  // CTA
  ctx.fillStyle = '#444444';
  ctx.font = 'italic 22px serif';
  ctx.fillText(cta, POSTER_W / 2, titleY + 240);

  // QR centrado abajo
  if (qrImg && qrImg.complete) {
    const qrSize = 150;
    const qx = (POSTER_W - qrSize) / 2;
    const qy = POSTER_H - qrSize - 100;
    ctx.drawImage(qrImg, qx, qy, qrSize, qrSize);
  }
};

// ---------- Template "Promo" ----------
// Fondo saturado + diagonal + badge "NUEVO".
const drawPromo = (ctx, opts) => {
  const { title, price, cta, color, productImg, qrImg } = opts;
  // Fondo
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);

  // Diagonal blanca abajo
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(0, 450);
  ctx.lineTo(POSTER_W, 350);
  ctx.lineTo(POSTER_W, POSTER_H);
  ctx.lineTo(0, POSTER_H);
  ctx.closePath();
  ctx.fill();

  // Badge "NUEVO" arriba izquierda
  ctx.save();
  ctx.translate(100, 100);
  ctx.rotate(-0.15);
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 0, 0, 180, 60, 30);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('NUEVO', 90, 32);
  ctx.restore();

  // Imagen del producto grande, al centro
  drawProductImageOrPlaceholder(ctx, productImg, 200, 180, POSTER_W - 400, 400, 24);

  // Título
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  wrapText(ctx, title, 60, 630, POSTER_W - 120, 64, 2);

  // Precio GRANDE
  ctx.fillStyle = color;
  ctx.font = 'bold 110px sans-serif';
  ctx.fillText(price, POSTER_W / 2, 790);

  // CTA
  ctx.fillStyle = '#333333';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(cta, POSTER_W / 2, 930);

  // QR abajo derecha
  if (qrImg && qrImg.complete) {
    const qrSize = 160;
    const qx = POSTER_W - qrSize - 50;
    const qy = POSTER_H - qrSize - 50;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(qx - 6, qy - 6, qrSize + 12, qrSize + 12);
    ctx.drawImage(qrImg, qx, qy, qrSize, qrSize);
  }

  // Marca abajo izquierda
  ctx.fillStyle = '#333333';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('xololo.mx', 50, POSTER_H - 60);
};

export const POSTER_TEMPLATES = [
  { key: 'fresco', label: 'Fresco', draw: drawFresco },
  { key: 'elegante', label: 'Elegante', draw: drawElegante },
  { key: 'promo', label: 'Promo', draw: drawPromo },
];

export const POSTER_COLOR_SWATCHES = [
  '#ff6b35', // naranja
  '#2d7a46', // verde
  '#1e40af', // azul
  '#be185d', // magenta
  '#111111', // negro
];

export { POSTER_W, POSTER_H };
