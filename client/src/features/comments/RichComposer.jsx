// Rich-text box for comments and board posts (FR-COM-01) with @mentions (FR-COM-03).
// Typing "@" followed by a few letters lists matching project members; picking one
// inserts "@Full Name" and remembers their id. Loaded on demand (Tiptap is large).
import Link from '@tiptap/extension-link';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Link2, List, ListOrdered } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

const MENTION_QUERY = /@([\p{L}\p{N}.' -]{0,30})$/u;

function ToolButton({ label, active, onClick, children }) {
  return (
    <button type="button" aria-label={label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={onClick} className={cn('rounded p-1.5 hover:bg-accent', active && 'bg-accent')}>
      {children}
    </button>
  );
}

/**
 * @param {object} props
 * @param {Array<{id, full_name}>} props.people  who can be mentioned
 * @param {(value: {body: string, text: string, mention_user_ids: string[]}) => Promise<unknown>|void} props.onSubmit
 * @param {React.ReactNode} [props.footer]  extra controls (visibility, attachments)
 */
export default function RichComposer({ people = [], onSubmit, onCancel, submitLabel, pending, initialHtml = '', label, placeholder, footer, autoFocus = false }) {
  const [query, setQueryState] = useState(null); // text after "@", or null
  const queryRef = useRef(null); // the editor's key handler is created once, so it reads this
  const setQuery = (q) => {
    queryRef.current = q;
    setQueryState(q);
  };
  const [mentioned, setMentioned] = useState(() => new Map());
  const [empty, setEmpty] = useState(!initialHtml);
  const listRef = useRef(null);
  const listId = useId();
  const hintId = useId();

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false, link: false }), Link.configure({ openOnClick: false, protocols: ['http', 'https', 'mailto'] })],
    content: initialHtml,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        class: 'min-h-16 px-3 py-2 text-sm outline-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_a]:text-brand-text [&_a]:underline',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        'aria-describedby': hintId,
      },
      handleKeyDown: (_view, event) => {
        // Arrow down moves into the mention list; Escape closes it
        if (queryRef.current !== null && event.key === 'ArrowDown') {
          listRef.current?.querySelector('button')?.focus();
          return true;
        }
        if (queryRef.current !== null && event.key === 'Escape') {
          setQuery(null);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      setEmpty(ed.isEmpty);
      const { from } = ed.state.selection;
      const before = ed.state.doc.textBetween(Math.max(0, from - 32), from, '\n', '\0');
      const m = MENTION_QUERY.exec(before);
      setQuery(m ? m[1] : null);
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from } = ed.state.selection;
      const m = MENTION_QUERY.exec(ed.state.doc.textBetween(Math.max(0, from - 32), from, '\n', '\0'));
      setQuery(m ? m[1] : null);
    },
  });

  if (!editor) return null;

  const matches = query === null ? [] : people.filter((p) => p.full_name.toLowerCase().startsWith(query.trim().toLowerCase())).slice(0, 6);

  const pick = (person) => {
    const { from } = editor.state.selection;
    editor.chain().focus().deleteRange({ from: from - (query.length + 1), to: from }).insertContent(`@${person.full_name} `).run();
    setMentioned((m) => new Map(m).set(person.id, person.full_name));
    setQuery(null);
  };

  const setLink = () => {
    const url = window.prompt(t('tasks.panel.linkPrompt'), editor.getAttributes('link').href ?? 'https://');
    if (url === null) return;
    if (url === '') editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const submit = async () => {
    if (editor.isEmpty || pending) return;
    const text = editor.getText();
    // Only people whose "@Name" is still in the text are mentioned
    const ids = [...mentioned].filter(([, name]) => text.includes(`@${name}`)).map(([id]) => id);
    const ok = await onSubmit({ body: editor.getHTML(), text, mention_user_ids: ids });
    if (ok !== false) {
      editor.commands.clearContent(true);
      setMentioned(new Map());
      setEmpty(true);
    }
  };

  return (
    <div className="relative rounded-md border bg-background focus-within:ring-[3px] focus-within:ring-ring/50">
      <div className="flex gap-1 border-b p-1">
        <ToolButton label={t('tasks.panel.editorBold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold aria-hidden="true" className="size-4" />
        </ToolButton>
        <ToolButton label={t('tasks.panel.editorItalic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic aria-hidden="true" className="size-4" />
        </ToolButton>
        <ToolButton label={t('tasks.panel.editorBullets')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List aria-hidden="true" className="size-4" />
        </ToolButton>
        <ToolButton label={t('tasks.panel.editorNumbers')} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered aria-hidden="true" className="size-4" />
        </ToolButton>
        <ToolButton label={t('tasks.panel.editorLink')} active={editor.isActive('link')} onClick={setLink}>
          <Link2 aria-hidden="true" className="size-4" />
        </ToolButton>
      </div>
      <div className="relative">
        {empty ? (
          <p aria-hidden="true" className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
            {placeholder}
          </p>
        ) : null}
        <EditorContent editor={editor} />
      </div>
      <p id={hintId} className="sr-only">
        {placeholder}
      </p>
      {matches.length ? (
        <ul ref={listRef} id={listId} aria-label={t('comments.mentionList')} className="absolute start-2 z-30 mt-1 w-64 rounded-md border bg-card p-1 shadow-overlay">
          {matches.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                onClick={() => pick(p)}
                onKeyDown={(e) => {
                  const items = listRef.current.querySelectorAll('button');
                  if (e.key === 'ArrowDown') items[Math.min(i + 1, items.length - 1)].focus();
                  if (e.key === 'ArrowUp') (i === 0 ? editor.commands.focus() : items[i - 1].focus());
                  if (e.key === 'Escape') {
                    setQuery(null);
                    editor.commands.focus();
                  }
                }}
              >
                {p.full_name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2 border-t p-2">
        {footer}
        {onCancel ? (
          <button type="button" className="rounded px-3 py-1.5 text-sm hover:bg-accent" onClick={onCancel}>
            {t('common.cancel')}
          </button>
        ) : null}
        <button type="button" disabled={empty || pending} onClick={submit} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
