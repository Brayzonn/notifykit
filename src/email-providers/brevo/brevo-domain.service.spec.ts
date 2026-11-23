import { BadGatewayException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError, AxiosHeaders } from 'axios';
import { of, throwError } from 'rxjs';
import { BrevoDomainService } from './brevo-domain.service';

const API_KEY = 'xkeysib-test';
const BASE = 'https://api.brevo.com/v3/senders/domains';

const axiosError = (status: number, message: string) => {
  const error = new AxiosError(message);
  error.response = {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { code: 'invalid_parameter', message },
  };
  return error;
};

const dnsRecords = {
  brevo_code: {
    host_name: '@',
    type: 'TXT',
    value: 'brevo-code:abc',
    status: false,
  },
  dkim_record: {
    host_name: 'mail._domainkey',
    type: 'TXT',
    value: 'k=rsa;p=XYZ',
    status: true,
  },
  dmarc_record: {
    host_name: '_dmarc',
    type: 'TXT',
    value: 'v=DMARC1; p=none',
    status: false,
  },
};

describe('BrevoDomainService', () => {
  let service: BrevoDomainService;
  let http: {
    post: jest.Mock;
    get: jest.Mock;
    put: jest.Mock;
    delete: jest.Mock;
  };

  beforeEach(() => {
    http = {
      post: jest.fn(),
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    };
    service = new BrevoDomainService(http as unknown as HttpService);
  });

  describe('authenticateDomain', () => {
    it('creates the domain and returns fully qualified DNS records', async () => {
      http.post.mockReturnValue(
        of({
          data: { id: 5, domain_name: 'acme.com', dns_records: dnsRecords },
        }),
      );

      const result = await service.authenticateDomain('acme.com', API_KEY);

      expect(http.post).toHaveBeenCalledWith(
        BASE,
        { name: 'acme.com' },
        { headers: expect.objectContaining({ 'api-key': API_KEY }) },
      );
      expect(result).toEqual({
        domainId: 'acme.com',
        valid: false,
        dnsRecords: [
          { type: 'TXT', host: 'acme.com', value: 'brevo-code:abc' },
          {
            type: 'TXT',
            host: 'mail._domainkey.acme.com',
            value: 'k=rsa;p=XYZ',
          },
          { type: 'TXT', host: '_dmarc.acme.com', value: 'v=DMARC1; p=none' },
        ],
      });
    });

    it('fetches the existing domain when Brevo says it already exists', async () => {
      http.post.mockReturnValue(
        throwError(() =>
          axiosError(400, 'Domain already exists in your account'),
        ),
      );
      http.get.mockReturnValue(
        of({
          data: {
            domain: 'acme.com',
            verified: true,
            authenticated: true,
            dns_records: { dkim_record: dnsRecords.dkim_record },
          },
        }),
      );

      const result = await service.authenticateDomain('acme.com', API_KEY);

      expect(http.get).toHaveBeenCalledWith(
        `${BASE}/acme.com`,
        expect.any(Object),
      );
      expect(result).toEqual({
        domainId: 'acme.com',
        valid: true,
        dnsRecords: [
          {
            type: 'TXT',
            host: 'mail._domainkey.acme.com',
            value: 'k=rsa;p=XYZ',
          },
        ],
      });
    });

    it('throws BadGateway on other errors', async () => {
      http.post.mockReturnValue(
        throwError(() => axiosError(401, 'Key not found')),
      );

      await expect(
        service.authenticateDomain('acme.com', API_KEY),
      ).rejects.toThrow(BadGatewayException);
    });
  });

  describe('validateDomain', () => {
    it('authenticates then reports the domain status', async () => {
      http.put.mockReturnValue(of({ data: {} }));
      http.get.mockReturnValue(
        of({
          data: {
            domain: 'acme.com',
            verified: true,
            authenticated: true,
            dns_records: dnsRecords,
          },
        }),
      );

      const result = await service.validateDomain('acme.com', API_KEY);

      expect(http.put).toHaveBeenCalledWith(
        `${BASE}/acme.com/authenticate`,
        {},
        expect.any(Object),
      );
      expect(result.valid).toBe(true);
    });

    it('treats a 400 from authenticate as not yet verified', async () => {
      http.put.mockReturnValue(
        throwError(() =>
          axiosError(400, 'DNS records not properly configured'),
        ),
      );
      http.get.mockReturnValue(
        of({
          data: {
            domain: 'acme.com',
            verified: false,
            authenticated: false,
            dns_records: dnsRecords,
          },
        }),
      );

      const result = await service.validateDomain('acme.com', API_KEY);

      expect(result.valid).toBe(false);
      expect(result.validationResults.records).toEqual([
        { record: 'brevo_code', valid: false },
        { record: 'dkim_record', valid: true },
        { record: 'dmarc_record', valid: false },
      ]);
    });

    it('throws BadGateway when authenticate fails for another reason', async () => {
      http.put.mockReturnValue(
        throwError(() => axiosError(404, 'Domain not found')),
      );

      await expect(service.validateDomain('acme.com', API_KEY)).rejects.toThrow(
        BadGatewayException,
      );
      expect(http.get).not.toHaveBeenCalled();
    });
  });

  describe('deleteDomain', () => {
    it('deletes by domain name', async () => {
      http.delete.mockReturnValue(of({ data: {} }));

      await service.deleteDomain('acme.com', API_KEY);

      expect(http.delete).toHaveBeenCalledWith(
        `${BASE}/acme.com`,
        expect.any(Object),
      );
    });

    it('rethrows the Brevo error message', async () => {
      http.delete.mockReturnValue(
        throwError(() => axiosError(404, 'Domain not found')),
      );

      await expect(service.deleteDomain('acme.com', API_KEY)).rejects.toThrow(
        'Domain not found',
      );
    });
  });
});
