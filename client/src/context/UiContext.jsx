import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import Modal from '../components/Modal.jsx';

const UiContext = createContext(null);
export const useUi = () => useContext(UiContext);

const ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };

/** Toast notifications + promise-based confirm / reason-prompt dialogs. */
export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const idRef = useRef(0);

  const push = useCallback((type, message, ms = 4500) => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-3), { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);
  const toast = {
    success: (m) => push('success', m), error: (m) => push('error', m, 7000),
    warning: (m) => push('warning', m, 6000), info: (m) => push('info', m),
  };

  /** confirm({title, message, confirmText, danger, prompt:'Reason', promptRequired}) -> Promise<false | true | string> */
  const confirm = useCallback((opts) => new Promise((resolve) => setDialog({ ...opts, resolve })), []);
  const close = (val) => { dialog?.resolve(val); setDialog(null); };

  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          return (
            <div key={t.id} className={`toast toast-${t.type}`} role="status">
              <Icon size={18} /> <span>{t.message}</span>
              <button className="icon-btn" aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X size={14} /></button>
            </div>
          );
        })}
      </div>
      {dialog && <ConfirmDialog dialog={dialog} onClose={close} />}
    </UiContext.Provider>
  );
}

function ConfirmDialog({ dialog, onClose }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const needsText = !!dialog.prompt;
  const disabled = needsText && dialog.promptRequired !== false && text.trim().length < 3;
  return (
    <Modal title={dialog.title || 'Please confirm'} onClose={() => onClose(false)} size="sm"
      footer={<>
        <button className="btn btn-ghost" onClick={() => onClose(false)}>{dialog.cancelText || 'Cancel'}</button>
        <button className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`} disabled={disabled} onClick={() => onClose(needsText ? text.trim() : true)}>{dialog.confirmText || 'Confirm'}</button>
      </>}>
      {dialog.message && <p className="muted" style={{ marginTop: 0, whiteSpace: 'pre-line' }}>{dialog.message}</p>}
      {needsText && (
        <label className="field">
          <span>{dialog.prompt}</span>
          <textarea ref={inputRef} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type at least 3 characters" maxLength={255} />
        </label>
      )}
    </Modal>
  );
}
