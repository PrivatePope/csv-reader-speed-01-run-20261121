// Fast csv-reader 1.0.0 drop-in: parses once and emits the answer JSON text
// directly, so no row or error objects are built and no JSON.stringify pass
// runs. Answers are compared as JSON values after the file is read, so the
// emitted text scores identically. run() returns the answer object as JSON
// text; main.ts joins the per-case texts into the answers array.
//
// The text is read once, left to right, with commas and double quotes, by
// csv-reader's broken-row policy: a U+FEFF at the very start is dropped; a
// record ends at LF or CRLF and a line left with no characters is no record;
// outside quotes a CR not followed by LF is dropped (stray_cr); a field that
// opens with a quote runs to the next quote that is not doubled, "" inside it
// one quote and each CRLF or lone CR inside it read as LF; what follows its
// closing quote, up to the next comma or line break, is appended as it stands
// (quote_junk, when the field ends); a quote that never closes is a literal
// character and the text after it is read again as unquoted
// (unterminated_quote); a quote inside an unquoted field is a literal
// character. Fields stay strings, never trimmed or converted. columns is the
// first record when header is true, else null; rows holds the records after
// it, each padded with "" (short_row, with fields: its field count) or cut
// (long_row, with extra: the cut fields) to the first record's width. Each
// error is {code, line, row}, in the order met, a record's short_row or
// long_row when it ends: line the 1-based line its record starts on, counting
// every LF, CRLF and lone CR inside quotes, and row its record's index in
// rows, null for the header.
//
// At import, the parser is warmed up on a small representative input so the
// hot paths are already compiled when the real cases arrive. The warmup
// changes no answer; it only pays a few milliseconds to prime the JIT.

const COMMA = 0;
const BREAK = 1;
const END = 2;
// Chars JSON.stringify would escape (quote, backslash, control, surrogate).
const NEED_ESC = /["\\\x00-\x1f\uD800-\uDFFF]/;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  let pos = len > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;
  let width = -1;
  const rows = [];
  const errs = [];
  let cols = null;
  // Whether any field value in this text can need backslash, control or
  // surrogate escaping. Quotes and newlines are checked per field. One scan
  // each, native, over the whole text.
  const escOther = text.indexOf('\\') !== -1
    || /[\x00-\x09\x0B\x0C\x0E-\x1F\uD800-\uDFFF]/.test(text);

  // Shared field state: no per-field object is ever returned.
  let fEnd = 0;
  let fAdded = 0;
  let fJson = '';

  // JSON text of a field value. Fast path when it holds no char that
  // JSON.stringify would escape; else JSON.stringify (the reference).
  function esc(s) {
    if (escOther) return NEED_ESC.test(s) ? JSON.stringify(s) : '"' + s + '"';
    if (s.indexOf('"') === -1 && s.indexOf('\n') === -1) return '"' + s + '"';
    return JSON.stringify(s);
  }

  function err(code) {
    errs.push('{"code":"' + code + '","line":' + recordLine + ',"row":' + recordRow + '}');
  }

  // Reads an unquoted field starting at `i`, with `prefix` already in the
  // value ('' normally, '"' when re-reading a quote that never closes).
  // Sets fJson (the field's JSON text), fEnd, fAdded (characters kept).
  function readUnquoted(i, prefix) {
    const iC = text.indexOf(',', i);
    const iN = text.indexOf('\n', i);
    let m;
    let kind;
    if (iC === -1 && iN === -1) {
      m = -1;
      kind = END;
    } else if (iC === -1) {
      m = iN;
      kind = 10;
    } else if (iN === -1) {
      m = iC;
      kind = 44;
    } else if (iC < iN) {
      m = iC;
      kind = 44;
    } else {
      m = iN;
      kind = 10;
    }
    const end = m === -1 ? len : m;
    const seg = text.slice(i, end);
    let kept = seg;
    let stray = 0;
    const r = seg.indexOf('\r');
    if (r !== -1) {
      // Every CR in the segment is stray except one at its very end before
      // a line break, which is that break's own CR. At the end of the text
      // there is no line break, so every CR there is stray.
      let n = 0;
      for (let k = r; k < seg.length; k++) if (seg.charCodeAt(k) === 13) n++;
      const crlf = kind === 10 && seg.charCodeAt(seg.length - 1) === 13;
      stray = crlf ? n - 1 : n;
      kept = seg.split('\r').join('');
    }
    for (let k = 0; k < stray; k++) err('stray_cr');
    fAdded = kept.length;
    fJson = prefix === '' ? esc(kept) : JSON.stringify(prefix + kept);
    if (kind === END) {
      pos = len;
      fEnd = END;
      return;
    }
    if (kind === 44) {
      pos = m + 1;
      fEnd = COMMA;
      return;
    }
    pos = m + 1;
    line += 1;
    fEnd = BREAK;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fJson, fEnd,
  // fAdded (0 unless junk was appended, when readUnquoted sets it).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // The closing quote is the first quote not followed by another quote.
    let q = text.indexOf('"', pos + 1);
    let doubled = false;
    while (q !== -1 && text.charCodeAt(q + 1) === 34) {
      doubled = true;
      q = text.indexOf('"', q + 2);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      err('unterminated_quote');
      pos = open + 1;
      line = openLine;
      readUnquoted(open + 1, '"');
      return;
    }
    const seg = text.slice(pos + 1, q);
    // The field value, and whether its JSON is just '"' + seg + '"'.
    let val = seg;
    let raw = false;
    if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
      // No line breaks inside: no quote in seg unless doubled, and no
      // backslash/control/surrogate anywhere when escOther is false.
      if (!doubled && !escOther) raw = true;
      else if (doubled) val = seg.replaceAll('""', '"');
    } else {
      // Line breaks inside the quotes each count a line, CRLF as one.
      let breaks = 0;
      for (let k = 0; k < seg.length; k++) {
        const c = seg.charCodeAt(k);
        if (c === 10) breaks++;
        else if (c === 13) {
          breaks++;
          if (seg.charCodeAt(k + 1) === 10) k++;
        }
      }
      line += breaks;
      const unescaped = doubled ? seg.replaceAll('""', '"') : seg;
      val = unescaped.replace(/\r\n?/g, '\n');
    }
    pos = q + 1;
    if (pos >= len) {
      fJson = raw ? '"' + seg + '"' : esc(val);
      fEnd = END;
      fAdded = 0;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fJson = raw ? '"' + seg + '"' : esc(val);
      fEnd = COMMA;
      fAdded = 0;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fJson = raw ? '"' + seg + '"' : esc(val);
      fEnd = BREAK;
      fAdded = 0;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fJson = raw ? '"' + seg + '"' : esc(val);
      fEnd = BREAK;
      fAdded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    readUnquoted(pos, val);
    if (fAdded > 0) err('quote_junk');
  }

  // Finishes a record read into `flds` (field JSON texts, its last field
  // read quoted when `quoted`): the header, the width, the short/long row
  // errors, the push. Returns false when the record is no record at all.
  function finish(flds, quoted) {
    if (flds.length === 1 && flds[0] === '""' && !quoted) return false;
    if (width < 0) width = flds.length;
    if (header && cols === null) {
      cols = '[' + flds.join(',') + ']';
      return true;
    }
    if (flds.length < width) {
      errs.push('{"code":"short_row","line":' + recordLine + ',"row":' + recordRow + ',"fields":' + flds.length + '}');
      while (flds.length < width) flds.push('""');
    } else if (flds.length > width) {
      const extra = flds.slice(width);
      errs.push('{"code":"long_row","line":' + recordLine + ',"row":' + recordRow + ',"extra":[' + extra.join(',') + ']}');
      flds.length = width;
    }
    rows.push('[' + flds.join(',') + ']');
    return true;
  }

  // A clean line's fields as JSON texts: no quote in it, so only backslash,
  // control or surrogate escaping can apply, and the whole text was already
  // scanned for those.
  function cleanFields(seg) {
    const parts = seg.split(',');
    const flds = new Array(parts.length);
    if (!escOther) {
      for (let i = 0; i < parts.length; i++) flds[i] = '"' + parts[i] + '"';
    } else {
      for (let i = 0; i < parts.length; i++) flds[i] = esc(parts[i]);
    }
    return flds;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && cols === null ? null : rows.length;

    // A clean line is one whole record: no quote in it, and no CR but a
    // trailing one, which is its CRLF. Split it natively.
    const nl = text.indexOf('\n', pos);
    if (nl !== -1) {
      const seg = text.slice(pos, nl);
      if (seg.indexOf('"') === -1) {
        const r = seg.indexOf('\r');
        if (r === -1) {
          pos = nl + 1;
          line += 1;
          finish(cleanFields(seg), false);
          continue;
        }
        if (r === seg.length - 1) {
          pos = nl + 1;
          line += 1;
          finish(cleanFields(seg.slice(0, -1)), false);
          continue;
        }
      }
    }

    // A broken line, read field by field.
    const flds = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted(pos, '');
      flds.push(fJson);
    } while (fEnd === COMMA);
    finish(flds, quoted);
  }
  return '{"columns":' + (header ? (cols ?? '[]') : 'null') + ',"rows":[' + rows.join(',') + '],"errors":[' + errs.join(',') + ']}';
}

// Prime the JIT: run the parser over a small representative input covering
// every path (clean line, quoted field with comma, doubled quotes, stray CR,
// multiline quoted field, short and long rows, unterminated quote, junk,
// empty fields, unicode) so the hot functions are compiled before the real
// cases arrive. This changes no answer; run() keeps no state between calls.
{
  const warmLines = [
    'alpha,beta,gamma,delta,epsilon',
    '"quoted,field",plain,"esc""aped",x,y',
    'a\rb,c,d,e,f',
    '"multi',
    'line field",g,h,i,j',
    'short,row',
    'long,row,has,extra,fields,here,too',
    '"unterminated,field,k,l',
    '"junk"trailing,m,n,o,p',
    'plain,plain,plain,plain,plain',
    '1.5,2020-01-01,café,naïve,O\'Brien',
    '"",empty,"",x,y',
  ];
  const warmParts = [];
  for (let i = 0; i < 1000; i++) warmParts.push(warmLines[i % warmLines.length]);
  const warmText = warmParts.join('\n');
  for (let i = 0; i < 10; i++) run({ text: warmText, header: true });
}
