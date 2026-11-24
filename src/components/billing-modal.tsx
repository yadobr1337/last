"use client";

import { useState } from "react";
import { CreditCard, Landmark, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { PendingButton } from "@/components/ui/pending-button";

type BillingModalProps = {
  transactions: Array<{ id: string; description: string; amount: string; createdAt: string }>;
  paymentsEnabled: boolean;
  topUpAction: (formData: FormData) => Promise<void>;
};

export function BillingModal({ transactions, paymentsEnabled, topUpAction }: BillingModalProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} size="lg">
        <Plus size={19} aria-hidden="true" /> Пополнить
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Пополнить баланс" layout="wide">
        <div className="grid gap-4 md:grid-cols-[.9fr_1.1fr]">
          <section className="ui-card bg-background" aria-label="Пополнение баланса">
            <h3 className="text-lg font-semibold tracking-tight">Пополнение</h3>
            <form action={topUpAction} className="mt-4 grid gap-4">
              <label className="grid gap-2 text-sm text-muted">
                Сумма в рублях
                <Input defaultValue="199" min="10" name="amount" step="1" type="number" inputMode="numeric" required />
              </label>
              <fieldset className="grid grid-cols-2 gap-2">
                <legend className="mb-2 text-sm text-muted">Способ оплаты</legend>
                <label className="payment-option">
                  <input defaultChecked name="method" type="radio" value="bank_card" />
                  <CreditCard size={17} aria-hidden="true" /> Картой
                </label>
                <label className="payment-option">
                  <input name="method" type="radio" value="sbp" />
                  <Landmark size={17} aria-hidden="true" /> СБП
                </label>
              </fieldset>
              {paymentsEnabled ? (
                <PendingButton className="w-full">Перейти к оплате</PendingButton>
              ) : (
                <Notice>Онлайн-оплата пока недоступна. Напишите в поддержку, чтобы пополнить баланс.</Notice>
              )}
            </form>
          </section>
          <section className="ui-card bg-background min-w-0" aria-label="История пополнений">
            <h3 className="text-lg font-semibold tracking-tight">История пополнений</h3>
            {transactions.length ? (
              <ul className="mt-3 max-h-[45dvh] overflow-y-auto">
                {transactions.map((transaction) => (
                  <li key={transaction.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3 last:border-0">
                    <div className="min-w-0 max-w-full">
                      <p className="break-words font-medium">{transaction.description}</p>
                      <p className="mt-1 text-sm text-subtle">{transaction.createdAt}</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums text-emerald-300">+{transaction.amount}</p>
                  </li>
                ))}
              </ul>
            ) : <div className="mt-3"><EmptyState>Пополнений пока не было.</EmptyState></div>}
          </section>
        </div>
      </Modal>
    </>
  );
}
