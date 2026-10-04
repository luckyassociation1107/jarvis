/**
 * JARVIS Document Intelligence — read any file, answer anything.
 *
 * Supports: PDF, DOCX, XLSX, CSV, TXT, MD, HTML, JSON, code files
 * Features: summarize, extract tables, answer questions, analyze
 */

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { extname, basename } from 'node:path'
import { complete } from './local-llm.mjs'

function sh(cmd) { try { return execSync(cmd, { encoding: 'utf8', timeout: 30_000 }).trim() } catch { return null } }

/* ──────────────── File reading ──────────────────────────── */

/**
 * Read any file and extract text content.
 */
export function readFile(filePath) {
  if (!existsSync(filePath)) return { ok: false, error: `File not found: ${filePath}` }

  const ext = extname(filePath).toLowerCase()
  const name = basename(filePath)

  try {
    // Text files
    if (['.txt', '.md', '.json', '.csv', '.ts', '.js', '.mjs', '.py', '.java', '.c', '.cpp', '.h', '.css', '.html', '.xml', '.yaml', '.yml', '.toml', '.ini', '.conf', '.sh', '.bash', '.zsh', '.fish', '.sql', '.r', '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala'].includes(ext)) {
      const content = readFileSync(filePath, 'utf8').slice(0, 100_000)
      return { ok: true, content, type: 'text', name, lines: content.split('\n').length }
    }

    // PDF
    if (ext === '.pdf') {
      const out = sh(`pdftotext "${filePath}" - 2>/dev/null`)
      if (out) return { ok: true, content: out.slice(0, 100_000), type: 'pdf', name, pages: (out.match(/\f/g) ?? []).length + 1 }
      // Try python
      const py = sh(`python3 -c "
import sys
try:
    import PyPDF2
    reader = PyPDF2.PdfReader('${filePath}')
    for page in reader.pages[:50]: print(page.extract_text())
except:
    print('ERROR: PyPDF2 not installed')
" 2>/dev/null`)
      if (py && !py.includes('ERROR')) return { ok: true, content: py.slice(0, 100_000), type: 'pdf', name }
      return { ok: false, error: 'Cannot read PDF. Install poppler-utils or PyPDF2.' }
    }

    // DOCX
    if (ext === '.docx') {
      const out = sh(`python3 -c "
try:
    from docx import Document
    doc = Document('${filePath}')
    for p in doc.paragraphs: print(p.text)
except Exception as e: print(f'ERROR: {e}')
" 2>/dev/null`)
      if (out && !out.startsWith('ERROR')) return { ok: true, content: out.slice(0, 100_000), type: 'docx', name }
      return { ok: false, error: 'Cannot read DOCX. Install python-docx.' }
    }

    // XLSX
    if (ext === '.xlsx' || ext === '.xls') {
      const out = sh(`python3 -c "
try:
    import openpyxl
    wb = openpyxl.load_workbook('${filePath}', data_only=True)
    for sheet in wb.sheetnames:
        ws = wb[sheet]
        print(f'--- Sheet: {sheet} ---')
        for row in ws.iter_rows(max_row=100, values_only=True):
            print('\t'.join(str(c) if c is not None else '' for c in row))
except Exception as e: print(f'ERROR: {e}')
" 2>/dev/null`)
      if (out && !out.startsWith('ERROR')) return { ok: true, content: out.slice(0, 100_000), type: 'xlsx', name }
      return { ok: false, error: 'Cannot read XLSX. Install openpyxl.' }
    }

    // Images
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
      return { ok: true, content: `[Image file: ${name}]`, type: 'image', name, path: filePath }
    }

    return { ok: true, content: readFileSync(filePath, 'utf8').slice(0, 50_000), type: 'unknown', name }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

/* ──────────────── AI analysis ──────────────────────────── */

/**
 * Summarize a document.
 */
export async function summarize(filePath) {
  const doc = readFile(filePath)
  if (!doc.ok) return doc

  const response = await complete('reason', [
    { role: 'system', content: 'You are a document analyst. Summarize the document concisely. If it is code, explain what it does. If it is data, highlight key findings.' },
    { role: 'user', content: `Summarize this ${doc.type} file (${doc.name}):\n\n${doc.content.slice(0, 8000)}` },
  ], { maxTokens: 500 })

  return { ok: true, summary: response, type: doc.type, name: doc.name }
}

/**
 * Ask a question about a document.
 */
export async function askAbout(filePath, question) {
  const doc = readFile(filePath)
  if (!doc.ok) return doc

  const response = await complete('reason', [
    { role: 'system', content: 'You are a document analyst. Answer questions about the document precisely. Cite specific parts when possible.' },
    { role: 'user', content: `Document: ${doc.name} (${doc.type})\n\nContent:\n${doc.content.slice(0, 8000)}\n\nQuestion: ${question}` },
  ], { maxTokens: 500 })

  return { ok: true, answer: response, type: doc.type, name: doc.name }
}

/**
 * Extract tables from a document.
 */
export async function extractTables(filePath) {
  const doc = readFile(filePath)
  if (!doc.ok) return doc

  if (doc.type === 'xlsx' || doc.type === 'csv') {
    const response = await complete('reason', [
      { role: 'system', content: 'Extract and format the data as a clean markdown table. Show all columns and key rows.' },
      { role: 'user', content: doc.content.slice(0, 8000) },
    ], { maxTokens: 800 })
    return { ok: true, tables: response, type: doc.type }
  }

  return { ok: false, error: 'Table extraction works best with CSV/XLSX files' }
}

/**
 * Analyze code files.
 */
export async function analyzeCode(filePath) {
  const doc = readFile(filePath)
  if (!doc.ok) return doc

  const response = await complete('reason', [
    { role: 'system', content: 'You are a code analyst. Explain what this code does, identify potential bugs, suggest improvements. Be concise.' },
    { role: 'user', content: `File: ${doc.name}\n\n${doc.content.slice(0, 10000)}` },
  ], { maxTokens: 800 })

  return { ok: true, analysis: response, name: doc.name }
}

export default { readFile, summarize, askAbout, extractTables, analyzeCode }