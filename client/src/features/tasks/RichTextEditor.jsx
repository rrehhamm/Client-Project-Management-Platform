// FR-TSK-01 rich-text description. Loaded on demand so Tiptap stays out of the main bundle.
// The server cleans the HTML again (lib/richText.js); this editor only offers safe marks.
import Link from '@tiptap/extension-link';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Link2, List, ListOrdered } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n';
import { cn } from '@/lib/utils';

function ToolButton({ label, active, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn('rounded p-1.5 hover:bg-accent', active && 'bg-accent')}
    >
      {children}
    </button>
  );
}

export default function RichTextEditor({ value, editable, onSave, pending, labelId }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, codeBlock: false, horizontalRule: false, link: false }), Link.configure({ openOnClick: false, protocols: ['http', 'https', 'mailto'] })],
    content: value ?? '',
    editable,
    editorProps: { attributes: { class: 'prose-sm min-h-24 px-3 py-2 outline-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline', 'aria-labelledby': labelId, role: 'textbox', 'aria-multiline': 'true' } },
  });
  if (!editor) return null;

  const setLink = () => {
    const url = window.prompt(t('tasks.panel.linkPrompt'), editor.getAttributes('link').href ?? 'https://');
    if (url === null) return;
    if (url === '') editor.chain().focus().unsetLink().run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="rounded-md border">
      {editable ? (
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
      ) : null}
      <EditorContent editor={editor} />
      {editable ? (
        <div className="flex justify-end border-t p-2">
          <Button size="sm" disabled={pending} onClick={() => onSave(editor.isEmpty ? null : editor.getHTML())}>
            {t('tasks.panel.saveDescription')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
