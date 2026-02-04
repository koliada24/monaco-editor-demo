import './App.css';
import 'bootstrap/dist/css/bootstrap.min.css';
import { useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { Button, Container, Row, Col, Form, Alert } from 'react-bootstrap';

const api_url = 'http://localhost:5062';

function App() {
  const [code, setCode] = useState<string>(`using System;

class Program
{
    static void Main()
    {
        Console.WriteLine("Hello, C# in Monaco!");
    }
}`);
  const [fileName, setFileName] = useState<string>('Program');
  const [message, setMessage] = useState<string | null>(null);
  const monacoRef = useRef<any>(null);

  const handleEditorMount: OnMount = (editor, monaco) => {
    monacoRef.current = { editor, monaco };

    const keywords = [
      'abstract','as','base','bool','break','byte','case','catch','char','checked','class','const','continue','decimal','default','delegate','do','double','else','enum','event','explicit','extern','false','finally','fixed','float','for','foreach','goto','if','implicit','in','int','interface','internal','is','lock','long','namespace','new','null','object','operator','out','override','params','private','protected','public','readonly','ref','return','sbyte','sealed','short','sizeof','stackalloc','static','string','struct','switch','this','throw','true','try','typeof','uint','ulong','unchecked','unsafe','ushort','using','virtual','void','volatile','while'
    ];

    monaco.languages.registerCompletionItemProvider('csharp', {
      provideCompletionItems: (model: any, position: any) => {
        const textUntilPosition = model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
        const words = Array.from(new Set(textUntilPosition.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [])).slice(-200);

        const suggestions = [
          ...keywords.map(k => ({ label: k, kind: monaco.languages.CompletionItemKind.Keyword, insertText: k })),
          ...words.map(w => ({ label: w, kind: monaco.languages.CompletionItemKind.Value, insertText: w }))
        ];

        return { suggestions };
      }
    });
  };

  const diagTimerRef = useRef<number | null>(null);

  async function saveFile() {
    setMessage(null);
    try {
      console.log(`${api_url}/api/code/${encodeURIComponent(fileName)}`);
      const res = await fetch(`${api_url}/api/code/${encodeURIComponent(fileName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: code })
      });
      if (!res.ok) throw new Error(await res.text());
      setMessage('Saved.');
      // run diagnostics after a save
      const diags = await fetchDiagnostics(code);
      applyDiagnosticsToEditor(diags);
    } catch (err: any) {
      setMessage('Error saving: ' + (err.message || err));
    }
  }

  async function fetchDiagnostics(content: string) {
    try {
      const res = await fetch(`${api_url}/api/diagnostics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  function applyDiagnosticsToEditor(diags: any[]) {
    const cur = monacoRef.current;
    if (!cur) return;
    const { editor, monaco } = cur;
    const model = editor.getModel();
    if (!model) return;
    const safeDiags = Array.isArray(diags) ? diags : [];
    const markers = safeDiags.map(d => {
      const r = d?.Range || d?.range || {};
      const startLineNumber = r?.StartLine ?? r?.startLine ?? 1;
      const startColumn = r?.StartColumn ?? r?.startColumn ?? 1;
      const endLineNumber = r?.EndLine ?? r?.endLine ?? startLineNumber;
      const endColumn = r?.EndColumn ?? r?.endColumn ?? startColumn;
      const severity = (d?.Severity === 'Error' || d?.severity === 'Error')
        ? monaco.MarkerSeverity.Error
        : (d?.Severity === 'Warning' || d?.severity === 'Warning')
          ? monaco.MarkerSeverity.Warning
          : monaco.MarkerSeverity.Info;
      const message = `${d?.Id ? d.Id + ': ' : ''}${d?.Message ?? d?.message ?? ''}`.trim();
      return {
        startLineNumber,
        startColumn,
        endLineNumber,
        endColumn,
        message: message || 'Diagnostic',
        severity
      };
    });

    monaco.editor.setModelMarkers(model, 'csharp', markers);
  }

  function onCodeChange(newCode: string) {
    setCode(newCode);
    if (diagTimerRef.current) window.clearTimeout(diagTimerRef.current);
    diagTimerRef.current = window.setTimeout(async () => {
      const diags = await fetchDiagnostics(newCode);
      applyDiagnosticsToEditor(diags);
    }, 500) as unknown as number;
  }

  async function loadFile() {
    setMessage(null);
    try {
      const res = await fetch(`${api_url}/api/code/${encodeURIComponent(fileName)}`);
      if (res.status === 404) {
        setMessage('File not found.');
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const body = await res.json();
      setCode(body.content || '');
      setMessage('Loaded.');
    } catch (err: any) {
      setMessage('Error loading: ' + (err.message || err));
    }
  }

  return (
    <Container fluid className="p-3">
      <Row className="mb-2">
        <Col md="auto">
          <Form.Control value={fileName} onChange={e => setFileName(e.target.value)} placeholder="File name (no extension)" />
        </Col>
        <Col md="auto">
          <Button onClick={saveFile} variant="primary">Save</Button>
        </Col>
        <Col md="auto">
          <Button onClick={loadFile} variant="secondary">Load</Button>
        </Col>
        <Col>
          {message && <Alert variant="info" className="mb-0">{message}</Alert>}
        </Col>
      </Row>

      <Row>
        <Col>
          <Editor
            height="75vh"
            defaultLanguage="csharp"
            value={code}
            onMount={handleEditorMount}
            onChange={(v) => onCodeChange(v || '')}
            options={{ automaticLayout: true, fontSize: 14, minimap: { enabled: false } }}
          />
        </Col>
      </Row>
    </Container>
  );
}

export default App;
