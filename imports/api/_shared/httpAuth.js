import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';

const parseCookies = (cookieHeader) => {
  const cookies = {};
  if (!cookieHeader) return cookies;
  for (const pair of cookieHeader.split(';')) {
    const [key, ...rest] = pair.trim().split('=');
    if (key) cookies[key.trim()] = decodeURIComponent(rest.join('=').trim());
  }
  return cookies;
};

/**
 * Resolve the userId from an HTTP request by reading the meteor_login_token cookie.
 * Returns the userId string or null if not authenticated.
 */
export const resolveUserId = async (req) => {
  const cookies = parseCookies(req.headers?.cookie);
  const token = cookies.meteor_login_token;
  if (!token) return null;
  const hashedToken = Accounts._hashLoginToken(token);
  const user = await Meteor.users.findOneAsync(
    { 'services.resume.loginTokens.hashedToken': hashedToken },
    { fields: { _id: 1 } }
  );
  return user?._id || null;
};
