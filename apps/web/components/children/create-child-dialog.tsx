// apps/web/components/children/create-child-dialog.tsx
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCreateChild } from '@/lib/hooks/use-children';
import type { ReactNode } from 'react';

const schema = z.object({
  name: z.string().trim().min(1, 'Укажите имя').max(120, 'Слишком длинное имя'),
  dateOfBirth: z.string().optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

export function CreateChildDialog({ trigger }: { trigger?: ReactNode } = {}) {
  const [open, setOpen] = useState(false);
  const create = useCreateChild();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    try {
      await create.mutateAsync({
        name: values.name,
        dateOfBirth: values.dateOfBirth ? values.dateOfBirth : undefined,
      });
      toast.success('Ребёнок добавлен');
      reset();
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось создать');
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button>Добавить ребёнка</Button>}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый ребёнок</DialogTitle>
          <DialogDescription>Заполните имя и (по желанию) дату рождения.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Имя</Label>
            <Input id="name" autoFocus {...register('name')} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="dob">Дата рождения</Label>
            <Input id="dob" type="date" {...register('dateOfBirth')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Сохраняем…' : 'Создать'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
