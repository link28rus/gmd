import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { importPKCS8, importSPKI, SignJWT, jwtVerify } from 'jose';
import type { KeyLike } from 'jose';
import { readFileSync } from 'node:fs';

export interface JwtConfig {
  privateKeyPath: string;
  publicKeyPath: string;
  accessTtlSec: number;
}

export interface JwtPayload {
  sub: string;
  familyId: string;
  role: 'owner' | 'parent';
}

export const JWT_CONFIG = Symbol('JWT_CONFIG');

@Injectable()
export class JwtService implements OnModuleInit {
  private privateKey!: KeyLike;
  private publicKey!: KeyLike;

  constructor(@Inject(JWT_CONFIG) private readonly cfg: JwtConfig) {}

  async onModuleInit(): Promise<void> {
    const priv = readFileSync(this.cfg.privateKeyPath, 'utf-8');
    const pub = readFileSync(this.cfg.publicKeyPath, 'utf-8');
    this.privateKey = await importPKCS8(priv, 'RS256');
    this.publicKey = await importSPKI(pub, 'RS256');
  }

  async signAccessToken(payload: JwtPayload): Promise<string> {
    return new SignJWT({ familyId: payload.familyId, role: payload.role })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(payload.sub)
      .setIssuedAt()
      .setExpirationTime(`${this.cfg.accessTtlSec}s`)
      .sign(this.privateKey);
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    const { payload } = await jwtVerify(token, this.publicKey, {
      algorithms: ['RS256'],
      clockTolerance: '30s',
    });
    return {
      sub: String(payload.sub),
      familyId: String(payload.familyId),
      role: payload.role as 'owner' | 'parent',
    };
  }
}
