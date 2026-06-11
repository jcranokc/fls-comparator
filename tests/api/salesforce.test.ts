/**
 * Tests for lib/api/salesforce.ts query builders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock browser.runtime.sendMessage
const mockSendMessage = vi.fn();
vi.stubGlobal('browser', {
  runtime: {
    sendMessage: mockSendMessage,
  },
});

// Mock store/snapshots to avoid storage dependency
vi.mock('../../lib/store/snapshots', () => ({
  getSettings: async () => ({
    apiVersion: '61.0',
    maxSnapshots: 50,
    defaultOrgLabel: '',
  }),
}));

import { describeObjects, describeFields, fetchFLS, applyFLSChanges } from '../../lib/api/salesforce';
import type { ApplyChange } from '../../lib/api/salesforce';
import type { SalesforceSession } from '../../lib/api/types';

const testSession: SalesforceSession = {
  instanceUrl: 'https://test.my.salesforce.com',
  sessionId: 'test-session-id',
  orgId: '00D000000000001',
};

describe('Salesforce API', () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
  });

  describe('describeObjects', () => {
    it('should send a REST_GET message for sobjects', async () => {
      mockSendMessage.mockResolvedValue({
        type: 'API_RESPONSE',
        payload: {
          sobjects: [
            { name: 'Account', label: 'Account', custom: false, queryable: true, createable: true, layoutable: true },
            { name: 'Contact', label: 'Contact', custom: false, queryable: true, createable: true, layoutable: true },
            { name: 'MyCustom__c', label: 'My Custom', custom: true, queryable: true, createable: true, layoutable: true },
          ],
        },
      });

      const result = await describeObjects(testSession);

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'REST_GET',
        payload: {
          instanceUrl: testSession.instanceUrl,
          sessionId: testSession.sessionId,
          path: '/services/data/v61.0/sobjects',
        },
      });

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Account');
      // Should be sorted by label
      expect(result.map(o => o.label)).toEqual(['Account', 'Contact', 'My Custom']);
    });

    it('should filter out non-queryable and non-layoutable objects', async () => {
      mockSendMessage.mockResolvedValue({
        type: 'API_RESPONSE',
        payload: {
          sobjects: [
            { name: 'Account', label: 'Account', custom: false, queryable: true, createable: true, layoutable: true },
            { name: 'ApexPage', label: 'Apex Page', custom: false, queryable: true, createable: false, layoutable: false },
          ],
        },
      });

      const result = await describeObjects(testSession);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Account');
    });

    it('should throw on API error', async () => {
      mockSendMessage.mockResolvedValue({
        type: 'API_ERROR',
        payload: { message: 'Unauthorized', statusCode: 401 },
      });

      await expect(describeObjects(testSession)).rejects.toThrow('Unauthorized');
    });
  });

  describe('describeFields', () => {
    it('should send a REST_GET message for field describe', async () => {
      mockSendMessage.mockResolvedValue({
        type: 'API_RESPONSE',
        payload: {
          name: 'Contact',
          label: 'Contact',
          fields: [
            { name: 'Email', label: 'Email', type: 'email', custom: false, permissionable: true },
            { name: 'Id', label: 'Contact ID', type: 'id', custom: false, permissionable: false },
            { name: 'Custom__c', label: 'Custom', type: 'string', custom: true, permissionable: true },
          ],
        },
      });

      const result = await describeFields(testSession, 'Contact');

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'REST_GET',
        payload: {
          instanceUrl: testSession.instanceUrl,
          sessionId: testSession.sessionId,
          path: '/services/data/v61.0/sobjects/Contact/describe',
        },
      });

      // Should filter out non-permissionable fields
      expect(result).toHaveLength(2);
      expect(result.map(f => f.name)).toContain('Email');
      expect(result.map(f => f.name)).not.toContain('Id');
    });
  });

  describe('applyFLSChanges', () => {
    const permSetChange: ApplyChange = {
      permissionSetId: '0PS000000000001',
      permissionSetName: 'Admin',
      field: 'Contact.Formula__c',
      type: 'PermissionSet',
      currentRead: false,
      currentEdit: false,
      newRead: true,
      newEdit: true,
    };

    function mockExistingFpQuery(records = []) {
      mockSendMessage.mockResolvedValueOnce({
        type: 'API_RESPONSE',
        payload: { totalSize: records.length, done: true, records },
      });
    }

    function mockExecuteAnonymous(result: { compiled?: boolean; success: boolean; compileProblem?: string; exceptionMessage?: string }) {
      mockSendMessage.mockResolvedValueOnce({
        type: 'API_RESPONSE',
        payload: { status: 200, body: JSON.stringify(result) },
      });
    }

    it('returns empty result immediately for empty changes', async () => {
      const result = await applyFLSChanges(testSession, []);
      expect(result.appliedCount).toBe(0);
      expect(result.skipped).toHaveLength(0);
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('runs Apex DML and returns applied count on success', async () => {
      mockExistingFpQuery();
      mockExecuteAnonymous({ compiled: true, success: true });

      const result = await applyFLSChanges(testSession, [permSetChange]);

      expect(result.appliedCount).toBe(1);
      expect(result.skipped).toHaveLength(0);
    });

    it('throws with Apex error message on failure', async () => {
      mockExistingFpQuery();
      mockExecuteAnonymous({ compiled: true, success: false, exceptionMessage: 'Field is not writeable: Formula__c' });

      await expect(applyFLSChanges(testSession, [permSetChange]))
        .rejects.toThrow('Field is not writeable: Formula__c');
    });

    it('throws with compile problem message', async () => {
      mockExistingFpQuery();
      mockExecuteAnonymous({ compiled: false, success: false, compileProblem: 'Unexpected token' });

      await expect(applyFLSChanges(testSession, [permSetChange]))
        .rejects.toThrow('Unexpected token');
    });
  });

  describe('fetchFLS', () => {
    it('follows nextRecordsUrl to collect all profiles across multiple pages', async () => {
      // Page 1 of profiles returns done:false with a continuation URL
      mockSendMessage
        // 1a. Profiles — page 1 (REST_QUERY)
        .mockResolvedValueOnce({
          type: 'API_RESPONSE',
          payload: {
            totalSize: 3,
            done: false,
            nextRecordsUrl: '/services/data/v61.0/query/page2',
            records: [
              { Id: 'profile1', Name: 'System Administrator' },
              { Id: 'profile2', Name: 'Standard User' },
            ],
          },
        })
        // 2. Backing PermSets — runs in parallel, single page
        .mockResolvedValueOnce({
          type: 'API_RESPONSE',
          payload: {
            totalSize: 2,
            done: true,
            records: [
              { Id: 'ps1', ProfileId: 'profile1' },
              { Id: 'ps2', ProfileId: 'profile2' },
            ],
          },
        })
        // 3. Standalone PermSets — empty
        .mockResolvedValueOnce({ type: 'API_RESPONSE', payload: { totalSize: 0, done: true, records: [] } })
        // 4. FieldPermissions — single page
        .mockResolvedValueOnce({
          type: 'API_RESPONSE',
          payload: {
            totalSize: 1,
            done: true,
            records: [{ Id: 'fp1', ParentId: 'ps1', PermissionsRead: true, PermissionsEdit: true }],
          },
        })
        // 1b. Profiles — page 2 continuation (REST_GET)
        .mockResolvedValueOnce({
          type: 'API_RESPONSE',
          payload: {
            totalSize: 3,
            done: true,
            records: [{ Id: 'profile3', Name: 'Read Only' }],
          },
        });

      const snapshot = await fetchFLS(testSession, 'Contact', 'Email');

      // All three profiles from both pages must appear
      expect(snapshot.permissions).toHaveLength(3);
      expect(snapshot.permissions.map(p => p.name)).toEqual(
        expect.arrayContaining(['System Administrator', 'Standard User', 'Read Only'])
      );

      // Page 2 was fetched via REST_GET with the continuation path
      const calls = mockSendMessage.mock.calls.map(c => c[0]);
      expect(calls.some(c => c.type === 'REST_GET' && c.payload.path === '/services/data/v61.0/query/page2')).toBe(true);
    });

    it('should query FieldPermissions and PermissionSet types', async () => {
      // fetchFLS fires 4 queries in Promise.all: profiles, backing permsets, standalone permsets, FP records
      const emptyPage = { totalSize: 0, done: true, records: [] };
      mockSendMessage
        // 1. Profiles
        .mockResolvedValueOnce({
          type: 'API_RESPONSE',
          payload: {
            totalSize: 2,
            done: true,
            records: [
              { Id: 'profile1', Name: 'System Administrator' },
              { Id: 'profile2', Name: 'Standard User' },
            ],
          },
        })
        // 2. Backing PermissionSets (one per profile)
        .mockResolvedValueOnce({
          type: 'API_RESPONSE',
          payload: {
            totalSize: 2,
            done: true,
            records: [
              { Id: 'ps1', ProfileId: 'profile1' },
              { Id: 'ps2', ProfileId: 'profile2' },
            ],
          },
        })
        // 3. Standalone PermissionSets — none in this test
        .mockResolvedValueOnce({ type: 'API_RESPONSE', payload: emptyPage })
        // 4. FieldPermissions for Contact.Email
        .mockResolvedValueOnce({
          type: 'API_RESPONSE',
          payload: {
            totalSize: 2,
            done: true,
            records: [
              { Id: 'fp1', ParentId: 'ps1', PermissionsRead: true, PermissionsEdit: true },
              { Id: 'fp2', ParentId: 'ps2', PermissionsRead: true, PermissionsEdit: false },
            ],
          },
        });

      const snapshot = await fetchFLS(testSession, 'Contact', 'Email');

      expect(snapshot.objectApiName).toBe('Contact');
      expect(snapshot.fieldApiName).toBe('Email');
      expect(snapshot.permissions).toHaveLength(2);
      expect(snapshot.permissions[0].type).toBe('Profile');
      expect(snapshot.permissions[0].permissionsRead).toBe(true);
      expect(snapshot.permissions[1].permissionsEdit).toBe(false);
      expect(snapshot.org.orgId).toBe(testSession.orgId);
    });
  });
});
