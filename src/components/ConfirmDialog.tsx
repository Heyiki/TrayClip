import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
} from "@/components/ui/alert-dialog";
import { useTranslation } from "@/lib/i18n";
import { useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
                                open,
                                message,
                                confirmLabel,
                                cancelLabel,
                                variant = "default",
                                onConfirm,
                                onCancel,
                              }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const actionTaken = useRef(false);

  const handleConfirm = () => {
    actionTaken.current = true;
    onConfirm();
  };

  const handleCancel = () => {
    actionTaken.current = true;
    onCancel();
  };

  return (
      <AlertDialog open={open} onOpenChange={(isOpen) => {
        if (!isOpen && !actionTaken.current) onCancel();
      }}>
        <AlertDialogContent className="max-w-[280px]">
          <AlertDialogHeader>
            <AlertDialogDescription className="text-sm text-foreground">
              {message}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleCancel}>
              {cancelLabel ?? t.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
                variant={variant === "destructive" ? "destructive" : "default"}
                className={variant === "destructive" ? "text-red-600 hover:text-white hover:bg-red-600 dark:text-red-500 dark:hover:text-white dark:hover:bg-red-500" : ""}
                onClick={handleConfirm}
            >
              {confirmLabel ?? t.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
  );
}
