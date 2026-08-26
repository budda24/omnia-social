import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Provider } from '@prisma/client';
import { randomBytes, timingSafeEqual } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import dayjs from 'dayjs';
import { RealIP } from 'nestjs-real-ip';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';

const TICKET_SECONDS = 120;

/**
 * Omnia session bridge.
 *
 * The Omnia platform has already authenticated a tenant user. It asks this
 * controller — server to server, with a shared secret — for a one-time login
 * URL for that user; the console loads the URL inside its frame; the studio
 * sets its own `auth` cookie exactly as `/auth/login` would and lands on the
 * calendar. Studio users created this way have no password: the platform
 * session is the only way in. Disabled unless OMNIA_SSO_SECRET is set.
 */
@Controller('/auth/omnia')
export class OmniaSsoController {
  constructor(
    private _users: UsersService,
    private _organizations: OrganizationService,
    private _prisma: PrismaRepository<'user'>
  ) {}

  private secretMatches(given?: string) {
    const expected = process.env.OMNIA_SSO_SECRET || '';
    if (!expected || !given) return false;
    const a = Buffer.from(given);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  @Post('/session')
  async session(
    @Headers('x-omnia-sso-secret') secret: string,
    @Body() body: { tenantId?: string; tenantName?: string; email?: string },
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    if (!process.env.OMNIA_SSO_SECRET) {
      throw new HttpException('Omnia SSO is not configured', HttpStatus.NOT_FOUND);
    }
    if (!this.secretMatches(secret)) {
      throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
    }
    const email = (body?.email || '').trim().toLowerCase();
    const tenantId = (body?.tenantId || '').trim();
    if (!tenantId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpException('tenantId and a valid email are required', HttpStatus.BAD_REQUEST);
    }

    // A bridge user belongs to exactly one platform tenant: providerId is the
    // binding. An e-mail that already has a studio account outside this tenant
    // (a password sign-up, or another tenant) is never taken over.
    const boundTo = `omnia:${tenantId}`;
    const existing = await this._prisma.model.user.findFirst({
      where: { email, providerName: Provider.LOCAL },
      select: { id: true, providerId: true },
    });
    if (existing && existing.providerId !== boundTo) {
      throw new HttpException(
        'This e-mail belongs to a studio account outside this Omnia tenant.',
        HttpStatus.CONFLICT
      );
    }
    let userId: string | undefined = existing?.id;
    let created = false;
    if (!userId) {
      // One studio workspace per platform user, named after the tenant. No
      // password: `comparePassword` can never match an empty hash.
      const company = (body?.tenantName || `Omnia ${tenantId.slice(0, 8)}`)
        .trim()
        .slice(0, 128)
        .padEnd(3, '·');
      const org = await this._organizations.createOrgAndUser(
        {
          company,
          email,
          password: '',
          provider: Provider.LOCAL,
          providerId: boundTo,
          datafast_visitor_id: '',
        } as Omit<CreateOrgUserDto, 'providerToken'>,
        ip,
        userAgent
      );
      userId = org.users[0].user.id;
      created = true;
    }

    const ticket = AuthChecker.signJWT({
      omniaLogin: userId,
      tenantId,
      jti: randomBytes(16).toString('hex'),
      exp: dayjs().add(TICKET_SECONDS, 'seconds').unix(),
    });
    return {
      url: `${process.env.FRONTEND_URL}/api/auth/omnia/login?ticket=${encodeURIComponent(ticket)}`,
      expiresInSeconds: TICKET_SECONDS,
      created,
    };
  }

  @Get('/login')
  async login(@Query('ticket') ticket: string, @Res() response: Response) {
    const front = process.env.FRONTEND_URL!;
    if (!process.env.OMNIA_SSO_SECRET || !ticket) {
      return response.redirect(`${front}/auth/login`);
    }
    type Ticket = { omniaLogin?: string; jti?: string; tenantId?: string; exp?: number };
    let payload: Ticket;
    try {
      payload = AuthChecker.verifyJWT(ticket) as Ticket;
    } catch (err) {
      return response
        .status(HttpStatus.UNAUTHORIZED)
        .send('This Omnia login link is invalid or has expired. Open the Social tab again.');
    }
    // Single use: the first redemption claims the ticket id for as long as the
    // ticket could still verify; a replay within that window is refused.
    if (!payload?.jti || typeof payload.exp !== 'number' || !payload.tenantId) {
      return response.status(HttpStatus.UNAUTHORIZED).send('This Omnia login link is incomplete.');
    }
    const claimed = await ioRedis.set(`omnia-ticket:${payload.jti}`, '1', 'EX', TICKET_SECONDS + 5, 'NX');
    if (claimed !== 'OK') {
      return response
        .status(HttpStatus.UNAUTHORIZED)
        .send('This Omnia login link was already used. Open the Social tab again.');
    }
    const user = payload?.omniaLogin ? await this._users.getUserById(payload.omniaLogin) : null;
    if (!user || user.providerId !== `omnia:${payload.tenantId}`) {
      return response.status(HttpStatus.UNAUTHORIZED).send('This Omnia login link does not match a studio user.');
    }

    // Mirror of AuthService.jwt(): the session token is the user without the hash.
    const safeUser: Record<string, unknown> = { ...user };
    delete safeUser.password;
    const jwt = AuthChecker.signJWT(safeUser);
    response.cookie('auth', jwt, {
      domain: getCookieUrlFromDomain(front),
      ...(!process.env.NOT_SECURED
        ? { secure: true, httpOnly: true, sameSite: 'none' as const }
        : {}),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });
    if (process.env.NOT_SECURED) {
      response.header('auth', jwt);
    }
    return response.redirect(`${front}/launches`);
  }
}
