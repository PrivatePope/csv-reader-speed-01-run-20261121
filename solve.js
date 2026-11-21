// A faster drop-in for make.fun's csv-reader 1.0.0.
//
// run(input) returns, for every input {text, header}, exactly the answer
// csv-reader returns: {columns, rows, errors}. The text is read once, left
// to right, with commas and double quotes, by the same broken-row policy:
// a U+FEFF at the very start is dropped; a record ends at LF or CRLF and a
// line left with no characters is no record; outside quotes a CR not
// followed by LF is dropped (stray_cr); a field that opens with a quote
// runs to the next quote that is not doubled, "" inside it one quote and
// each CRLF or lone CR inside it read as LF; what follows its closing
// quote, up to the next comma or line break, is appended as it stands
// (quote_junk, when the field ends); a quote that never closes is a
// literal character and the text after it is read again as unquoted
// (unterminated_quote); a quote inside an unquoted field is a literal
// character; fields stay strings, never trimmed or converted. columns is
// the first record when header is true, else null; rows holds the records
// after it, each padded with "" (short_row) or cut (long_row) to the first
// record's width. Each error is {code, line, row}, in the order met.
//
// It is fast where csv-reader is plain: csv-reader builds every field one
// character at a time, while this reader cuts fields out with indexOf and
// slice, splits a clean line natively, and only walks a record field by
// field when the line is actually broken. No dependency, no state kept
// from one call to the next, nothing cached between cases.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const len = text.length;
  let pos = len > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;

  const err = (code) => {
    errors.push({ code, line: recordLine, row: recordRow });
  };

  // Reads an unquoted field starting at `i`, with `prefix` already in the
  // value ('' normally, '"' when re-reading a quote that never closes).
  // The field ends at the first comma or line break after `i`: everything
  // between is its content, stray CRs dropped (each one an error), a CR
  // right before the line break being the break's own. Returns
  // {value, ended, added}, where added counts the characters this read
  // kept, not the prefix and not the dropped CRs.
  function readUnquoted(i, prefix) {
    const iC = text.indexOf(',', i);
    const iN = text.indexOf('\n', i);
    let m;
    let kind; // 44 comma, 10 line break, 2 end of text
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
      // a line break, which is that break's own CR. At the end of the
      // text there is no line break, so every CR there is stray.
      let n = 0;
      for (let k = r; k < seg.length; k++) if (seg.charCodeAt(k) === 13) n++;
      const crlf = kind === 10 && seg.charCodeAt(seg.length - 1) === 13;
      stray = crlf ? n - 1 : n;
      kept = seg.split('\r').join('');
    }
    for (let k = 0; k < stray; k++) err('stray_cr');
    const value = prefix + kept;
    const added = kept.length;
    if (kind === END) {
      pos = len;
      return { value, ended: END, added };
    }
    if (kind === 44) {
      pos = m + 1;
      return { value, ended: COMMA, added };
    }
    pos = m + 1;
    line += 1;
    return { value, ended: BREAK, added };
  }

  // Reads a quoted field whose opening quote is at pos.
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
      return readUnquoted(open + 1, '"');
    }
    const seg = text.slice(pos + 1, q);
    let value;
    if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
      value = doubled ? seg.replaceAll('""', '"') : seg;
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
      value = unescaped.replace(/\r\n?/g, '\n');
    }
    pos = q + 1;
    if (pos >= len) return { value, ended: END, added: 0 };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA, added: 0 };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: BREAK, added: 0 };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: BREAK, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(pos, value);
    if (junk.added > 0) err('quote_junk');
    return junk;
  }

  // Finishes a record read into `fields` (its last field read quoted when
  // `quoted`): the header, the width, the short/long row errors, the push.
  // Returns false when the record is no record at all.
  function finish(fields, quoted) {
    if (fields.length === 1 && fields[0] === '' && !quoted) return false;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return true;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
    return true;
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
    recordRow = header && columns === null ? null : rows.length;

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
          finish(seg.split(','), false);
          continue;
        }
        if (r === seg.length - 1) {
          pos = nl + 1;
          line += 1;
          finish(seg.slice(0, -1).split(','), false);
          continue;
        }
      }
    }

    // A broken line, read field by field.
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted(pos, '');
      fields.push(field.value);
    } while (field.ended === COMMA);
    finish(fields, quoted);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
