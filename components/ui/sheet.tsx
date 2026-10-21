"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { Drawer } from "vaul";
import type { ReactNode } from "react";
import { useIsDesktop } from "@/lib/use-media";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name (visually hidden; sheets draw their own heading). */
  title: string;
  children: ReactNode;
  /** A sheet opened on top of another sheet (the parent scales back, as in iOS). */
  nested?: boolean;
  dismissible?: boolean;
  /** Pixel offset from the bottom: lifts the sheet above the on-screen keyboard. */
  bottomInset?: number;
  maxHeight?: string;
  className?: string;
  /** Show the drag handle at the top (default). A sheet with its own close button can turn it off. */
  handle?: boolean;
}

/**
 * Below 1024px: a Vaul bottom sheet (drag to dismiss, 60% scrim, 28px top radius, background scales back like iOS).
 * From 1024px: a centred 480px modal (PRD §5.2). The same children render in both.
 */
export function Sheet(props: SheetProps) {
  const desktop = useIsDesktop();
  return desktop ? <DesktopModal {...props} /> : <MobileSheet {...props} />;
}

function MobileSheet({ open, onOpenChange, title, children, nested, dismissible = true, bottomInset = 0, maxHeight, className, handle = true }: SheetProps) {
  const Root = nested ? Drawer.NestedRoot : Drawer.Root;
  return (
    <Root open={open} onOpenChange={onOpenChange} dismissible={dismissible} shouldScaleBackground={!nested} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay />
        <Drawer.Content
          className={`vaul-content ${className ?? ""}`}
          style={{ bottom: bottomInset, maxHeight: maxHeight ?? "96dvh" }}
        >
          {handle && <Drawer.Handle className="grabber" style={{ background: "var(--surface-3)", height: 5, width: 36, margin: "0 auto 14px", opacity: 1 }} />}
          <Drawer.Title className="sr-only">{title}</Drawer.Title>
          <Drawer.Description className="sr-only">{title}</Drawer.Description>
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Root>
  );
}

function DesktopModal({ open, onOpenChange, title, children, dismissible = true, className }: SheetProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal-content ${className ?? ""}`}
          onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
          onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
