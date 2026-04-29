import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { BadGatewayException } from '@nestjs/common';
import { AxiosError, AxiosHeaders } from 'axios';
import { of, throwError } from 'rxjs';
import { PostmarkDomainService } from './postmark-domain.service';

const ACCOUNT_TOKEN = 'pm-account-token';
const DOMAIN = 'mail.example.com';

const makeAxiosError = (status: number, message: string): AxiosError => {
  const headers = new AxiosHeaders();
  const err = new AxiosError(
    'Request failed',
    'ERR_BAD_REQUEST',
    { headers, url: '/domains', method: 'post' } as never,
    null,
    {
      status,
      statusText: 'Error',
      headers,
      config: { headers } as never,
      data: { Message: message },
    },
  );
  return err;
};

describe('PostmarkDomainService', () => {
  let service: PostmarkDomainService;
  let httpService: {
    post: jest.Mock;
    put: jest.Mock;
    get: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(async () => {
    httpService = {
      post: jest.fn(),
      put: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostmarkDomainService,
        { provide: HttpService, useValue: httpService },
      ],
    }).compile();

    service = module.get(PostmarkDomainService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('authenticateDomain', () => {
    it('creates the domain and returns its DNS records', async () => {
      httpService.post.mockReturnValueOnce(
        of({
          data: {
            ID: 42,
            Name: DOMAIN,
            DKIMVerified: false,
            ReturnPathDomainVerified: false,
            DKIMHost: '20240101pm._domainkey.mail.example.com',
            DKIMTextValue: 'k=rsa; p=...',
            ReturnPathDomain: 'pm-bounces.mail.example.com',
            ReturnPathDomainCNAMEValue: 'pm.mtasv.net',
          },
        }),
      );

      const result = await service.authenticateDomain(DOMAIN, ACCOUNT_TOKEN);

      expect(httpService.post).toHaveBeenCalledWith(
        'https://api.postmarkapp.com/domains',
        { Name: DOMAIN },
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Postmark-Account-Token': ACCOUNT_TOKEN,
          }),
        }),
      );
      expect(result.domainId).toBe('42');
      expect(result.valid).toBe(false);
      expect(result.dnsRecords).toEqual([
        {
          type: 'TXT',
          host: '20240101pm._domainkey.mail.example.com',
          value: 'k=rsa; p=...',
        },
        {
          type: 'CNAME',
          host: 'pm-bounces.mail.example.com',
          value: 'pm.mtasv.net',
        },
      ]);
    });

    it('falls back to fetching the existing domain on 422 "already" error', async () => {
      httpService.post.mockReturnValueOnce(
        throwError(() => makeAxiosError(422, 'Domain already exists.')),
      );
      httpService.get
        .mockReturnValueOnce(
          of({ data: { Domains: [{ ID: 7, Name: DOMAIN }] } }),
        )
        .mockReturnValueOnce(
          of({
            data: {
              ID: 7,
              Name: DOMAIN,
              DKIMVerified: true,
              ReturnPathDomainVerified: true,
              DKIMHost: 'h',
              DKIMTextValue: 'v',
            },
          }),
        );

      const result = await service.authenticateDomain(DOMAIN, ACCOUNT_TOKEN);

      expect(result.domainId).toBe('7');
      expect(result.valid).toBe(true);
      expect(httpService.get).toHaveBeenCalledTimes(2);
    });

    it('throws BadGatewayException for non-422 errors', async () => {
      httpService.post.mockReturnValueOnce(
        throwError(() => makeAxiosError(500, 'Internal error')),
      );

      await expect(
        service.authenticateDomain(DOMAIN, ACCOUNT_TOKEN),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('throws BadGatewayException when the domain cannot be found after a 422', async () => {
      httpService.post.mockReturnValueOnce(
        throwError(() => makeAxiosError(422, 'Domain already exists.')),
      );
      httpService.get.mockReturnValueOnce(of({ data: { Domains: [] } }));

      await expect(
        service.authenticateDomain(DOMAIN, ACCOUNT_TOKEN),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  describe('validateDomain', () => {
    it('triggers DKIM and ReturnPath verification then re-fetches the domain', async () => {
      httpService.put.mockReturnValue(of({ data: {} }));
      httpService.get.mockReturnValueOnce(
        of({
          data: {
            ID: 42,
            Name: DOMAIN,
            DKIMVerified: true,
            ReturnPathDomainVerified: true,
          },
        }),
      );

      const result = await service.validateDomain('42', ACCOUNT_TOKEN);

      expect(httpService.put).toHaveBeenNthCalledWith(
        1,
        'https://api.postmarkapp.com/domains/42/verifyDkim',
        {},
        expect.any(Object),
      );
      expect(httpService.put).toHaveBeenNthCalledWith(
        2,
        'https://api.postmarkapp.com/domains/42/verifyReturnPath',
        {},
        expect.any(Object),
      );
      expect(result).toEqual({
        valid: true,
        validationResults: { dkim: true, returnPath: true },
      });
    });

    it('reports invalid when only one of DKIM/ReturnPath is verified', async () => {
      httpService.put.mockReturnValue(of({ data: {} }));
      httpService.get.mockReturnValueOnce(
        of({
          data: {
            ID: 42,
            Name: DOMAIN,
            DKIMVerified: true,
            ReturnPathDomainVerified: false,
          },
        }),
      );

      const result = await service.validateDomain('42', ACCOUNT_TOKEN);
      expect(result.valid).toBe(false);
    });

    it('throws BadGatewayException on Postmark error', async () => {
      httpService.put.mockReturnValueOnce(
        throwError(() => makeAxiosError(500, 'fail')),
      );

      await expect(
        service.validateDomain('42', ACCOUNT_TOKEN),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });

  describe('deleteDomain', () => {
    it('issues a DELETE against the domain endpoint', async () => {
      httpService.delete.mockReturnValueOnce(of({ data: {} }));

      await service.deleteDomain('42', ACCOUNT_TOKEN);

      expect(httpService.delete).toHaveBeenCalledWith(
        'https://api.postmarkapp.com/domains/42',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Postmark-Account-Token': ACCOUNT_TOKEN,
          }),
        }),
      );
    });

    it('throws when Postmark rejects the delete', async () => {
      httpService.delete.mockReturnValueOnce(
        throwError(() => makeAxiosError(404, 'Not found')),
      );

      await expect(service.deleteDomain('42', ACCOUNT_TOKEN)).rejects.toThrow(
        'Not found',
      );
    });
  });
});
