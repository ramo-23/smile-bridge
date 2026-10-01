import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getCountryCallingCode, parsePhoneNumber, type CountryCode } from 'libphonenumber-js';

@Injectable()
export class PhoneNumberService {
  private readonly defaultRegion: CountryCode;

  constructor(config: ConfigService) {
    this.defaultRegion = config.getOrThrow<string>('DEFAULT_PHONE_REGION') as CountryCode;
  }

  normalize(value: string): string {
    try {
      const parsed = parsePhoneNumber(value, this.defaultRegion);
      if (!parsed.isValid()) throw new Error('invalid');
      return parsed.number;
    } catch {
      throw new BadRequestException('Invalid phone number');
    }
  }

  searchPrefix(value: string): string | null {
    const digits = value.replace(/\D/g, '');
    if (!digits) return null;
    const callingCode = getCountryCallingCode(this.defaultRegion);
    return `+${digits.startsWith(callingCode) ? digits : `${callingCode}${digits}`}`;
  }
}
