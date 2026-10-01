import { types } from 'pg';

types.setTypeParser(1082, (value) => value);