import isCryptogramInstrument from './is-cryptogram-instrument';
import { getPayment } from './payments.mock';

describe('isCryptogramLike', () => {
    it('returns true if the object looks like a cryptogram', () => {
        const paymentData = {
            cryptogramId: 'cryptogram_token_123',
            eci: 'eci123',
            transactionId: '123',
            ccExpiry: {
                month: '01',
                year: '20',
            },
            ccNumber: 'cc_number',
            accountMask: '01*****19'
        };
        expect(isCryptogramInstrument(paymentData)).toBeTruthy();
    });

    it('returns false if a Vaulted Instrument', () => {
        const paymentData = { instrumentId: 'my_instrument_id', cvv: 123 };
        expect(isCryptogramInstrument(paymentData)).toBeFalsy();
    });

    it('returns false if a Tokenized Credit Card', () => {
        const paymentData = { nonce: 'my_nonce', deviceSessionId: 'my_session_id' };
        expect(isCryptogramInstrument(paymentData)).toBeFalsy();
    });

    it('returns false if a Credit Card', () => {
        const { paymentData } = getPayment();
        expect(isCryptogramInstrument(paymentData)).toBeFalsy();
    });
});
