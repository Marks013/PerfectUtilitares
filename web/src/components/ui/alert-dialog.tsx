"use client";

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type * as React from "react";
import { cn } from "@/lib/utils";
import styles from "./alert-dialog.module.css";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
export const AlertDialogAction = AlertDialogPrimitive.Action;

export function AlertDialogContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-40 bg-neutral-950/40" />
      <AlertDialogPrimitive.Content
        className={cn(
          "z-50 app-radius-lg border app-border app-bg-card p-5 app-shadow outline-none",
          styles.content,
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}

export function AlertDialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-2", className)} {...props} />;
}

export function AlertDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("text-base font-semibold app-text text-balance", className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-sm app-text-muted text-pretty", className)}
      {...props}
    />
  );
}
