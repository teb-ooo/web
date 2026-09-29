/** A Huma validation failure (422), as RFC 9457 problem+json. */
export const validationProblem = {
  $schema: "http://localhost/schemas/ErrorModel.json",
  title: "Unprocessable Entity",
  status: 422,
  detail: "validation failed",
  errors: [
    { message: "expected length >= 3", location: "body.title", value: "ab" },
    { message: "expected number >= 1", location: "body.quantity", value: 0 },
    { message: "second message for title", location: "body.title", value: "ab" },
  ],
};
