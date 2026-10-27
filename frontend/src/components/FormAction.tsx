import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Plus } from "lucide-react";
import InlineDialog from "./InlineDialog";

export const FormActionContext = createContext({
  busy: false,
  error: "",
  revision: 0,
});

export default function FormAction({
  title,
  label,
  description,
  subtitleIcon,
  children,
  version,
  error,
  busy,
  onClose,
  className,
  icon,
}: {
  title: string;
  label?: string;
  description?: string;
  subtitleIcon?: ReactNode;
  children: ReactNode;
  version?: number;
  error?: string;
  busy?: boolean;
  onClose?: () => void;
  className?: string;
  icon?: ReactNode;
}) {
  const context = useContext(FormActionContext);
  const [open, setOpen] = useState(false);
  const currentVersion = version ?? context.revision;
  const started = useRef(currentVersion);
  const locked = busy ?? context.busy;
  const formId = useId();
  let content = children;
  let submit: ReactNode = null;
  if (
    isValidElement<{ children: ReactNode; id?: string }>(children) &&
    children.type === "form"
  ) {
    const nodes = Children.toArray(children.props.children);
    let index = -1;
    nodes.forEach((node, i) => {
      if (
        isValidElement<ButtonHTMLAttributes<HTMLButtonElement>>(node) &&
        node.type === "button" &&
        (!node.props.type || node.props.type === "submit")
      )
        index = i;
    });
    const button = nodes[index];
    if (isValidElement<ButtonHTMLAttributes<HTMLButtonElement>>(button)) {
      submit = cloneElement(button, {
        form: formId,
        type: "submit",
        disabled: locked || button.props.disabled,
      });
      content = cloneElement(
        children,
        { id: formId },
        nodes.filter((_, i) => i !== index),
      );
    }
  }
  function close() {
    setOpen(false);
    onClose?.();
  }
  useEffect(() => {
    if (open && currentVersion !== started.current) {
      setOpen(false);
      onClose?.();
    }
  }, [currentVersion, open, onClose]);
  return (
    <>
      <button
        type="button"
        className="button form-action-trigger"
        disabled={locked}
        onClick={() => {
          started.current = currentVersion;
          setOpen(true);
        }}
      >
        {icon ? (
          icon
        ) : /^(Adicionar|Nov[oa])/i.test(label || title) ? (
          <Plus size={15} aria-hidden="true" />
        ) : null}
        <span>{label || title}</span>
      </button>
      {open && (
        <InlineDialog
          title={title}
          subtitle={description || ""}
          subtitleIcon={subtitleIcon}
          busy={locked}
          onClose={close}
          className={className}
          footer={
            <footer className="form-action-footer">
              <button
                type="button"
                className="button"
                disabled={locked}
                onClick={close}
              >
                Cancelar
              </button>
              {submit}
            </footer>
          }
        >
          <div className="form-action-dialog">
            {(error ?? context.error) && (
              <p className="inline-error" role="alert">
                {error ?? context.error}
              </p>
            )}
            <fieldset disabled={locked}>{content}</fieldset>
          </div>
        </InlineDialog>
      )}
    </>
  );
}
