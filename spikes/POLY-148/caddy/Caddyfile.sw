{
	admin off
	auto_https off
	http_port 80
}

# As Caddyfile, plus: a request that carries Service-Worker: script (the browser fetching a worker's script) is refused. route keeps the order literal.
:80 {
	route {
		@sw header Service-Worker script
		respond @sw 403
		@auth path /api/auth /api/auth/* /sign-in /sign-in/* /sign-up /sign-up/*
		handle @auth {
			reverse_proxy host.docker.internal:58482
		}
		handle {
			reverse_proxy host.docker.internal:58481
		}
	}
}
