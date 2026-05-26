# syntax=docker/dockerfile:1.7

# ─── build stage ────────────────────────────────────────────────
FROM golang:1.24-alpine AS build

WORKDIR /src

# Cache modules first
COPY go.mod go.sum* ./
RUN go mod download

# Source
COPY . .

# Build a small static binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=$(go env GOARCH) \
    go build -trimpath -ldflags="-s -w" \
    -o /out/gateway ./cmd/gateway

# ─── runtime stage ──────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/gateway /gateway

USER nonroot:nonroot
EXPOSE 8080

ENTRYPOINT ["/gateway"]
