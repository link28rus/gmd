import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FamilyAccessGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const userId: string | undefined = req.user?.sub;
    const childId: string | undefined = req.params?.id;

    if (!userId || !childId) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }

    const child = await this.prisma.child.findFirst({
      where: {
        id: childId,
        deletedAt: null,
        family: { memberships: { some: { userId } } },
      },
    });

    if (!child) {
      throw new NotFoundException({ code: 'child_not_found', message: 'Child not found' });
    }

    req.targetChild = child;
    return true;
  }
}
