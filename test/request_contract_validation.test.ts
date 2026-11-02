import { DepartmentCreateSchema } from '../src/validators/department';
import { UserCreateSchema } from '../src/validators/user';
import * as userService from '../src/services/userService';
import User from '../src/models/User';

describe('request contract validation', () => {
  test('Department create schema requires organizationId', () => {
    const result = DepartmentCreateSchema.safeParse({
      name: 'Engineering',
      code: 'ENG',
    });

    expect(result.success).toBe(false);
  });

  test('User create schema requires a password', () => {
    const result = UserCreateSchema.safeParse({
      fullName: 'Jane Doe',
      email: 'jane@example.com',
      role: 'EMPLOYEE',
      employmentType: 'EMPLOYEE',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path.includes('password'))).toBe(true);
  });
});
