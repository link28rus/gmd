// apps/web/components/children/edit-child-dialog.tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateChild } from '@/lib/hooks/use-children';
import type { Child } from '@/lib/api/children';

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  dateOfBirth: z.string().optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  child: Child;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function EditChildDialog({ child, open, onOpenChange }: Props) {
  const update = useUpdateChild();
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: child.name,
      dateOfBirth: child.dateOfBirth ? child.dateOfBirth.slice(0, 10) : '',
    },
  });

  async function onSubmit(values: FormValues) {
    try {
      await update.mutateAsync({
        id: child.id,
        patch: {
          name: values.name,
          dateOfBirth: values.dateOfBirth ? values.dateOfBirth : null,
        },
      });
      toast.success('Изменения сохранены');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Редактировать ребёнка</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Имя</Label>
            <Input id="edit-name" {...register('name')} />
            {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-dob">Дата рождения</Label>
            <Input id="edit-dob" type="date" {...register('dateOfBirth')} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={!isDirty || update.isPending}>
              {update.isPending ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
