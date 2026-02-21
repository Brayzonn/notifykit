import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: jest.Mocked<Reflector>;

  const mockReflector = {
    getAllAndOverride: jest.fn(),
  };

  const createMockExecutionContext = (
    request: any = {},
    handler: any = {},
    classRef: any = {},
  ): ExecutionContext => {
    return {
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(request),
        getResponse: jest.fn(),
      }),
      getHandler: jest.fn().mockReturnValue(handler),
      getClass: jest.fn().mockReturnValue(classRef),
    } as any;
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        { provide: Reflector, useValue: mockReflector },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
    reflector = module.get(Reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('@Public() Decorator Support', () => {
    it('should check isPublic metadata using Reflector', () => {
      const request = { method: 'GET', url: '/public' };
      const context = createMockExecutionContext(request);

      reflector.getAllAndOverride.mockReturnValue(true);

      const result = guard.canActivate(context);

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith('isPublic', [
        context.getHandler(),
        context.getClass(),
      ]);
      expect(result).toBe(true);
    });

    it('should bypass authentication if isPublic=true', () => {
      const request = { method: 'POST', url: '/auth/signup' };
      const context = createMockExecutionContext(request);

      reflector.getAllAndOverride.mockReturnValue(true);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('should not call super.canActivate() for public routes', () => {
      const request = { method: 'GET', url: '/public' };
      const context = createMockExecutionContext(request);

      reflector.getAllAndOverride.mockReturnValue(true);

      const superSpy = jest.spyOn(
        Object.getPrototypeOf(JwtAuthGuard.prototype),
        'canActivate',
      );

      guard.canActivate(context);

      expect(superSpy).not.toHaveBeenCalled();
    });
  });

  describe('JWT Validation', () => {
    it('should delegate to super.canActivate() for protected routes', () => {
      const request = {
        method: 'GET',
        url: '/protected',
        headers: { authorization: 'Bearer valid.token' },
      };
      const context = createMockExecutionContext(request);

      reflector.getAllAndOverride.mockReturnValue(false);

      const superSpy = jest
        .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
        .mockReturnValue(true);

      guard.canActivate(context);

      expect(superSpy).toHaveBeenCalledWith(context);
    });

    it('should log authentication attempts (debug level)', () => {
      const request = {
        method: 'POST',
        url: '/api/users',
        headers: { authorization: 'Bearer token' },
      };
      const context = createMockExecutionContext(request);

      reflector.getAllAndOverride.mockReturnValue(false);

      jest
        .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
        .mockReturnValue(true);

      const loggerSpy = jest.spyOn(guard['logger'], 'debug');

      guard.canActivate(context);

      expect(loggerSpy).toHaveBeenCalledWith('Auth check: POST /api/users');
    });
  });

  describe('Error Handling', () => {
    it('should throw UnauthorizedException for TokenExpiredError', () => {
      const request = { method: 'GET', url: '/protected' };
      const context = createMockExecutionContext(request);

      const err = null;
      const user = null;
      const info = { name: 'TokenExpiredError', message: 'jwt expired' };

      expect(() => guard.handleRequest(err, user, info, context)).toThrow(
        UnauthorizedException,
      );
      expect(() => guard.handleRequest(err, user, info, context)).toThrow(
        'Token has expired',
      );
    });

    it('should throw UnauthorizedException for JsonWebTokenError', () => {
      const request = { method: 'GET', url: '/protected' };
      const context = createMockExecutionContext(request);

      const err = null;
      const user = null;
      const info = { name: 'JsonWebTokenError', message: 'invalid signature' };

      expect(() => guard.handleRequest(err, user, info, context)).toThrow(
        UnauthorizedException,
      );
      expect(() => guard.handleRequest(err, user, info, context)).toThrow(
        'Invalid token',
      );
    });

    it('should throw UnauthorizedException if no authorization header', () => {
      const request = { method: 'GET', url: '/protected', headers: {} };
      const context = createMockExecutionContext(request);

      const err = null;
      const user = null;
      const info = null;

      expect(() => guard.handleRequest(err, user, info, context)).toThrow(
        UnauthorizedException,
      );
      expect(() => guard.handleRequest(err, user, info, context)).toThrow(
        'No authorization token provided',
      );
    });

    it('should throw generic UnauthorizedException for unknown errors', () => {
      const request = {
        method: 'GET',
        url: '/protected',
        headers: { authorization: 'Bearer token' },
      };
      const context = createMockExecutionContext(request);

      const err = null;
      const user = null;
      const info = { message: 'Unknown error' };

      expect(() => guard.handleRequest(err, user, info, context)).toThrow(
        UnauthorizedException,
      );
      expect(() => guard.handleRequest(err, user, info, context)).toThrow(
        'Authentication failed',
      );
    });

    it('should re-throw error if err parameter is provided', () => {
      const request = {
        method: 'GET',
        url: '/protected',
        headers: { authorization: 'Bearer token' },
      };
      const context = createMockExecutionContext(request);

      const err = new Error('Custom error');
      const user = null;
      const info = null;

      expect(() => guard.handleRequest(err, user, info, context)).toThrow(
        'Custom error',
      );
    });

    it('should log authentication failures', () => {
      const request = {
        method: 'POST',
        url: '/api/sensitive',
        headers: { authorization: 'Bearer expired.token' },
      };
      const context = createMockExecutionContext(request);

      const loggerSpy = jest.spyOn(guard['logger'], 'warn');

      const err = null;
      const user = null;
      const info = { name: 'TokenExpiredError', message: 'jwt expired' };

      try {
        guard.handleRequest(err, user, info, context);
      } catch (e) {
        // Expected to throw
      }

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Auth failed: POST /api/sensitive'),
      );
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('jwt expired'),
      );
    });
  });

  describe('Success Cases', () => {
    it('should return user object on successful authentication', () => {
      const request = { method: 'GET', url: '/protected' };
      const context = createMockExecutionContext(request);

      const err = null;
      const user = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'USER',
      };
      const info = null;

      const result = guard.handleRequest(err, user, info, context);

      expect(result).toEqual(user);
    });

    it('should not throw error when user is authenticated', () => {
      const request = { method: 'GET', url: '/protected' };
      const context = createMockExecutionContext(request);

      const err = null;
      const user = { id: 'user-456', email: 'valid@example.com' };
      const info = null;

      expect(() => guard.handleRequest(err, user, info, context)).not.toThrow();
    });

    it('should preserve user object properties', () => {
      const request = { method: 'GET', url: '/protected' };
      const context = createMockExecutionContext(request);

      const err = null;
      const user = {
        id: 'user-789',
        email: 'user@example.com',
        role: 'ADMIN',
        name: 'Test User',
      };
      const info = null;

      const result = guard.handleRequest(err, user, info, context);

      expect(result).toHaveProperty('id', 'user-789');
      expect(result).toHaveProperty('email', 'user@example.com');
      expect(result).toHaveProperty('role', 'ADMIN');
      expect(result).toHaveProperty('name', 'Test User');
    });
  });

  describe('Integration with Reflector', () => {
    it('should check both handler and class metadata', () => {
      const request = { method: 'GET', url: '/test' };
      const handler = {};
      const classRef = {};
      const context = createMockExecutionContext(request, handler, classRef);

      reflector.getAllAndOverride.mockReturnValue(false);

      jest
        .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
        .mockReturnValue(true);

      guard.canActivate(context);

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith('isPublic', [
        handler,
        classRef,
      ]);
    });

    it('should prioritize handler metadata over class metadata', () => {
      const request = { method: 'GET', url: '/test' };
      const context = createMockExecutionContext(request);

      // getAllAndOverride already handles this priority
      reflector.getAllAndOverride.mockReturnValue(true);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
    });
  });
});
